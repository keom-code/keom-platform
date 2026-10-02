/**
 * M2A stall thresholds: how long after the customer's last message, with no business reply,
 * risk becomes MEDIUM and then HIGH (see OpportunityEngineService.computeRisk). They belong
 * to M2A — the decision "this much silence means this much risk" is a commercial rule.
 *
 * Env-configurable (read per call, like the rest of the API's config) so local demos can use
 * minutes instead of hours; defaults are the original M2A values (1h / 4h). M4 does not read
 * these to decide anything: it only asks for `stallCheckpointsMs()` to know WHEN M2A's
 * answer can change, and schedules a re-evaluation just after each checkpoint.
 */
const DEFAULT_MEDIUM_MINUTES = 60;
const DEFAULT_HIGH_MINUTES = 240;

export interface StallThresholds {
  mediumMs: number;
  highMs: number;
}

export function loadStallThresholds(): StallThresholds {
  const medium = readMinutes("OPPORTUNITY_STALL_MEDIUM_MINUTES", DEFAULT_MEDIUM_MINUTES);
  const high = readMinutes("OPPORTUNITY_STALL_HIGH_MINUTES", DEFAULT_HIGH_MINUTES);
  if (high <= medium) {
    throw new Error(`OPPORTUNITY_STALL_HIGH_MINUTES (${high}) must be greater than OPPORTUNITY_STALL_MEDIUM_MINUTES (${medium}).`);
  }
  return { mediumMs: medium * 60_000, highMs: high * 60_000 };
}

/** Elapsed times (since the last unanswered customer message) at which M2A's risk can change. */
export function stallCheckpointsMs(): number[] {
  const { mediumMs, highMs } = loadStallThresholds();
  return [mediumMs, highMs];
}

/** "4h", "90 min" — keeps the original M2A reason strings for hour-based values. */
export function formatDuration(ms: number): string {
  const minutes = ms / 60_000;
  return minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes} min`;
}

function readMinutes(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number of minutes, got "${raw}".`);
  }
  return value;
}
