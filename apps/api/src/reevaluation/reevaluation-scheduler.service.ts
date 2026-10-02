import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { stallCheckpointsMs } from "../opportunities/stall-thresholds";
import { loadReevaluationPolicy } from "./reevaluation.config";
import { ReevaluationQueue } from "./reevaluation.queue";
import { ReevaluationJob, ReevaluationSchedule, ReevaluationTrigger, ScheduledReevaluation } from "./reevaluation.types";

export interface EvaluatedOpportunityRef {
  id: string;
  companyId: string;
  conversationId: string;
  isActive: boolean;
}

export class ReevaluationSchedulingError extends Error {
  constructor(
    public readonly code: "DISABLED" | "NOT_FOUND" | "INVALID_TIME" | "QUEUE_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "ReevaluationSchedulingError";
  }
}

const MAX_FOLLOW_UP_DAYS = 90;

/**
 * M4 producer: decides WHEN to look at an opportunity again, never what it means.
 *
 * After every successful evaluation (M2A dev endpoint or M2B), it reads FRESH message
 * timestamps and schedules:
 * - NO_BUSINESS_REPLY just after each M2A stall checkpoint (stallCheckpointsMs) counted from
 *   the customer's last unanswered message — the only moments M2A's answer can change
 *   without new evidence. Checkpoints already in the past are skipped (the evaluation that
 *   just ran already saw them); nothing is scheduled if the business already replied.
 * - GENERAL_REEVALUATION once, REEVALUATION_ACTIVE_AFTER_HOURS later (rounded up to the hour
 *   so repeated evaluations within an hour share one job), as a safety net.
 * Re-evaluations never schedule further jobs, so there are no reschedule loops.
 *
 * Failures never break the caller: the evaluation is already persisted, so a Redis/config
 * problem is logged as ERROR and returned as { status: "FAILED" }.
 */
@Injectable()
export class ReevaluationScheduler {
  private readonly logger = new Logger(ReevaluationScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: ReevaluationQueue,
  ) {}

  async scheduleAfterEvaluation(opportunity: EvaluatedOpportunityRef, now: Date = new Date()): Promise<ReevaluationSchedule> {
    if (!this.queue.isEnabled()) return { status: "DISABLED", jobs: [] };
    if (!opportunity.isActive) return { status: "NOTHING_TO_SCHEDULE", jobs: [] };

    try {
      const policy = loadReevaluationPolicy();
      const planned: { trigger: ReevaluationTrigger; anchorAt: Date; at: Date }[] = [];

      const { lastInboundAt, lastOutboundAt } = await this.lastMessageTimes(opportunity);
      const unanswered = !!lastInboundAt && !(lastOutboundAt && lastOutboundAt >= lastInboundAt);
      if (unanswered) {
        for (const checkpointMs of stallCheckpointsMs()) {
          const at = new Date(lastInboundAt.getTime() + checkpointMs + policy.graceMs);
          if (at > now) planned.push({ trigger: "NO_BUSINESS_REPLY", anchorAt: lastInboundAt, at });
        }
      }
      if (policy.activeAfterMs > 0) {
        planned.push({ trigger: "GENERAL_REEVALUATION", anchorAt: now, at: ceilToHour(new Date(now.getTime() + policy.activeAfterMs)) });
      }

      if (planned.length === 0) return { status: "NOTHING_TO_SCHEDULE", jobs: [] };

      const jobs: ScheduledReevaluation[] = [];
      for (const plan of planned) {
        jobs.push(await this.enqueue(opportunity, plan.trigger, plan.anchorAt, plan.at, now));
      }
      return { status: "SCHEDULED", jobs };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to schedule re-evaluation for opportunityId=${opportunity.id} companyId=${opportunity.companyId}: ${message}`);
      return { status: "FAILED", jobs: [], error: message };
    }
  }

  /** Explicit FOLLOW_UP_DUE check at a caller-chosen time (dev endpoint). Throws on failure,
   * since here scheduling IS the request. */
  async scheduleFollowUp(params: { opportunityId: string; companyId: string; at: Date }, now: Date = new Date()): Promise<ScheduledReevaluation> {
    if (!this.queue.isEnabled()) {
      throw new ReevaluationSchedulingError("DISABLED", "Re-evaluation scheduling is disabled: REDIS_URL is not set.");
    }
    if (params.at <= now || params.at.getTime() - now.getTime() > MAX_FOLLOW_UP_DAYS * 24 * 3_600_000) {
      throw new ReevaluationSchedulingError("INVALID_TIME", `Follow-up time must be in the future and within ${MAX_FOLLOW_UP_DAYS} days.`);
    }
    const opportunity = await this.prisma.opportunity.findFirst({
      where: { id: params.opportunityId, companyId: params.companyId, isActive: true },
      select: { id: true, companyId: true },
    });
    if (!opportunity) {
      throw new ReevaluationSchedulingError("NOT_FOUND", `Active opportunity ${params.opportunityId} not found for this company.`);
    }
    try {
      return await this.enqueue(opportunity, "FOLLOW_UP_DUE", now, params.at, now);
    } catch (err) {
      throw new ReevaluationSchedulingError("QUEUE_FAILED", `Could not enqueue follow-up: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async enqueue(
    opportunity: { id: string; companyId: string },
    trigger: ReevaluationTrigger,
    anchorAt: Date,
    at: Date,
    now: Date,
  ): Promise<ScheduledReevaluation> {
    const job: ReevaluationJob = {
      v: 1,
      companyId: opportunity.companyId,
      opportunityId: opportunity.id,
      trigger,
      anchorAt: anchorAt.toISOString(),
      scheduledFor: at.toISOString(),
    };
    const jobId = await this.queue.add(job, at.getTime() - now.getTime());
    this.logger.log(
      `Scheduled ${trigger} jobId=${jobId} opportunityId=${opportunity.id} companyId=${opportunity.companyId} scheduledFor=${job.scheduledFor}`,
    );
    return { jobId, trigger, scheduledFor: job.scheduledFor };
  }

  private async lastMessageTimes(opportunity: EvaluatedOpportunityRef): Promise<{ lastInboundAt?: Date; lastOutboundAt?: Date }> {
    const [inbound, outbound] = await Promise.all(
      (["INBOUND", "OUTBOUND"] as const).map((direction) =>
        this.prisma.message.findFirst({
          where: { conversationId: opportunity.conversationId, companyId: opportunity.companyId, direction },
          orderBy: { sentAt: "desc" },
          select: { sentAt: true },
        }),
      ),
    );
    return { lastInboundAt: inbound?.sentAt, lastOutboundAt: outbound?.sentAt };
  }
}

function ceilToHour(date: Date): Date {
  const hour = 3_600_000;
  return new Date(Math.ceil(date.getTime() / hour) * hour);
}
