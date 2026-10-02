import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Job, UnrecoverableError, Worker } from "bullmq";
import IORedis from "ioredis";
import { OpportunitiesService, ReevaluationOutcome } from "../opportunities/opportunities.service";
import { redisUrl } from "./reevaluation.config";
import { REEVALUATION_QUEUE, ReevaluationJobSchema } from "./reevaluation.types";

const WORKER_CONCURRENCY = 5;

export interface JobContext {
  jobId: string;
  /** 1-based attempt number. */
  attempt: number;
  /** Execution time; injectable for tests. */
  now?: Date;
}

/**
 * M4 worker: when a re-evaluation job fires, hand the opportunity to M2A
 * (OpportunitiesService.reevaluate), which reloads everything fresh, tenant-scoped, and runs
 * the same deterministic engine. This class makes no commercial decision.
 *
 * Outcomes:
 * - NOT_FOUND (missing or tenant mismatch), INACTIVE, NOT_EVALUATED, UNCHANGED -> the job
 *   completes as a no-op (obsolete jobs need no cancellation).
 * - CHANGED -> M2A persisted the new result.
 * - Invalid payload -> UnrecoverableError: failed immediately, never retried.
 * - Anything thrown by M2A/DB -> retried by BullMQ (REEVALUATION_JOB_OPTIONS: 5 attempts,
 *   exponential backoff), then left failed. M2A writes only after a successful evaluation,
 *   so a failed attempt cannot corrupt the opportunity.
 *
 * Runs inside the API process when REDIS_URL is set; a separate worker process is a later
 * scaling step.
 */
@Injectable()
export class ReevaluationProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReevaluationProcessor.name);
  private connection: IORedis | null = null;
  private worker: Worker | null = null;

  constructor(private readonly opportunities: OpportunitiesService) {}

  onModuleInit(): void {
    const url = redisUrl();
    if (!url) return; // ReevaluationQueue already logs that M4 is disabled.

    // BullMQ workers require maxRetriesPerRequest=null (blocking commands).
    this.connection = new IORedis(url, { maxRetriesPerRequest: null });
    this.connection.on("error", (err) => this.logger.error(`Redis (worker) connection error: ${err.message}`));
    this.worker = new Worker(
      REEVALUATION_QUEUE,
      (job: Job) => this.handle(job.data, { jobId: job.id ?? "unknown", attempt: job.attemptsMade + 1 }),
      { connection: this.connection, concurrency: WORKER_CONCURRENCY },
    );
    this.worker.on("failed", (job, err) => {
      const attempts = job?.opts.attempts ?? 1;
      const exhausted = !job || err instanceof UnrecoverableError || job.attemptsMade >= attempts;
      const ids = `jobId=${job?.id} opportunityId=${job?.data?.opportunityId} companyId=${job?.data?.companyId} trigger=${job?.data?.trigger}`;
      if (exhausted) {
        this.logger.error(`Re-evaluation FAILED permanently after ${job?.attemptsMade ?? 0} attempt(s), ${ids}: ${err.message}`);
      } else {
        this.logger.warn(`Re-evaluation attempt ${job.attemptsMade}/${attempts} failed, will retry, ${ids}: ${err.message}`);
      }
    });
    this.worker.on("error", (err) => this.logger.error(`Re-evaluation worker error: ${err.message}`));
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    this.connection?.disconnect();
  }

  async handle(data: unknown, context: JobContext): Promise<ReevaluationOutcome["status"]> {
    const parsed = ReevaluationJobSchema.safeParse(data);
    if (!parsed.success) {
      throw new UnrecoverableError(`Invalid re-evaluation job payload (jobId=${context.jobId}): ${parsed.error.message}`);
    }
    const job = parsed.data;
    const executedAt = context.now ?? new Date();
    const ids = `jobId=${context.jobId} opportunityId=${job.opportunityId} companyId=${job.companyId} trigger=${job.trigger}`;
    const timing = `scheduledFor=${job.scheduledFor} executedAt=${executedAt.toISOString()} attempt=${context.attempt}`;

    const outcome = await this.opportunities.reevaluate({ opportunityId: job.opportunityId, companyId: job.companyId, now: executedAt });

    switch (outcome.status) {
      case "NOT_FOUND":
        this.logger.warn(`Re-evaluation no-op (opportunity not found for this company), ${ids} ${timing}`);
        break;
      case "INACTIVE":
      case "NOT_EVALUATED":
        this.logger.log(`Re-evaluation no-op (${outcome.status}), ${ids} ${timing}`);
        break;
      case "UNCHANGED":
        this.logger.log(
          `Re-evaluation unchanged (state=${outcome.evaluation.state} risk=${outcome.evaluation.risk} action=${outcome.evaluation.nextBestAction}), ${ids} ${timing}`,
        );
        break;
      case "CHANGED":
        this.logger.log(
          `Re-evaluation CHANGED state ${outcome.previous.state}->${outcome.opportunity.state}, risk ${outcome.previous.risk}->${outcome.opportunity.risk}, ` +
            `priority ${outcome.previous.priority}->${outcome.opportunity.priority}, action=${outcome.evaluation.nextBestAction}, ${ids} ${timing}`,
        );
        break;
    }
    return outcome.status;
  }
}
