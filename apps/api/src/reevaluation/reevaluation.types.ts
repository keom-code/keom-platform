import { z } from "zod";

/**
 * M4 Temporal Re-evaluation: shapes shared by the scheduler (producer) and the processor
 * (worker). M4 decides only WHEN an opportunity is looked at again; WHAT it means stays in
 * M2A (OpportunitiesService.reevaluate -> OpportunityEngineService). Nothing here encodes
 * risk, state, priority, score or next-best-action rules.
 */
export const REEVALUATION_QUEUE = "opportunity-reevaluation";

export const REEVALUATION_TRIGGERS = [
  /** The customer's last message is unanswered; fires just after each M2A stall checkpoint. */
  "NO_BUSINESS_REPLY",
  /** An explicit future check requested through the dev endpoint. */
  "FOLLOW_UP_DUE",
  /** One-shot safety net while an opportunity stays active (REEVALUATION_ACTIVE_AFTER_HOURS). */
  "GENERAL_REEVALUATION",
] as const;

export type ReevaluationTrigger = (typeof REEVALUATION_TRIGGERS)[number];

/** Minimal by design: ids and timing only. The worker reloads everything else from
 * PostgreSQL at execution time, so a job can never act on stale state. */
export const ReevaluationJobSchema = z.object({
  v: z.literal(1),
  companyId: z.string().uuid(),
  opportunityId: z.string().uuid(),
  trigger: z.enum(REEVALUATION_TRIGGERS),
  /** The event the timer is relative to (e.g. the unanswered customer message). */
  anchorAt: z.string().datetime(),
  scheduledFor: z.string().datetime(),
});

export type ReevaluationJob = z.infer<typeof ReevaluationJobSchema>;

/**
 * Deterministic job id: the same schedule requested twice maps to the same id, and BullMQ
 * ignores an add whose id already exists. BullMQ ids may not contain ":" (Redis key
 * separator) nor be purely numeric.
 */
export function reevaluationJobId(job: Pick<ReevaluationJob, "opportunityId" | "trigger" | "scheduledFor">): string {
  return `reeval-${job.opportunityId}-${job.trigger}-${Date.parse(job.scheduledFor)}`;
}

export interface ScheduledReevaluation {
  jobId: string;
  trigger: ReevaluationTrigger;
  scheduledFor: string;
}

/** Returned to callers (and dev endpoint responses) so scheduling is never silent. */
export type ReevaluationSchedule =
  | { status: "SCHEDULED"; jobs: ScheduledReevaluation[] }
  | { status: "NOTHING_TO_SCHEDULE"; jobs: [] }
  /** REDIS_URL is not set: M4 is off in this environment (logged as WARN at startup). */
  | { status: "DISABLED"; jobs: [] }
  /** Redis or config failure; logged as ERROR. The evaluation itself was already saved. */
  | { status: "FAILED"; jobs: []; error: string };
