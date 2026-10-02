/**
 * Env-driven M4 timing policy, read per call. Generic on purpose: nothing here is
 * industry-specific, and nothing here says what an amount of time *means* commercially —
 * stall thresholds live in M2A (src/opportunities/stall-thresholds.ts).
 *
 * REDIS_URL unset = M4 disabled (see ReevaluationQueue). Retry policy is fixed in code
 * (REEVALUATION_JOB_OPTIONS) rather than env, so it can't be configured into an infinite loop.
 */
const DEFAULT_GRACE_SECONDS = 30;
const DEFAULT_ACTIVE_AFTER_HOURS = 24;

export interface ReevaluationPolicy {
  /** Added after each M2A checkpoint so the job runs strictly after the threshold. */
  graceMs: number;
  /** Delay of the GENERAL_REEVALUATION safety net; 0 disables it. */
  activeAfterMs: number;
}

export function loadReevaluationPolicy(): ReevaluationPolicy {
  return {
    graceMs: readNonNegative("REEVALUATION_GRACE_SECONDS", DEFAULT_GRACE_SECONDS) * 1000,
    activeAfterMs: readNonNegative("REEVALUATION_ACTIVE_AFTER_HOURS", DEFAULT_ACTIVE_AFTER_HOURS) * 3_600_000,
  };
}

export function redisUrl(): string | null {
  return process.env.REDIS_URL || null;
}

/** Bounded retries for transient failures (DB/Redis): 5 attempts, 5s -> 10s -> 20s -> 40s.
 * Completed jobs are kept 7 days so a duplicate add within that window stays a no-op;
 * exhausted jobs are kept 14 days for inspection. */
export const REEVALUATION_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: "exponential", delay: 5_000 },
  removeOnComplete: { age: 7 * 24 * 3600 },
  removeOnFail: { age: 14 * 24 * 3600 },
} as const;

function readNonNegative(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number, got "${raw}".`);
  }
  return value;
}
