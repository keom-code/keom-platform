/**
 * Provider/persistence-independent shapes for the M2A deterministic Opportunity Engine.
 * Signals are supplied as structured input (fixtures/dev endpoint/tests) — inferring
 * them from Message.text via an LLM is M2B, not M2A. See apps/api/README.md.
 */

export type SignalType =
  | "PRICING_REQUESTED"
  | "AVAILABILITY_REQUESTED"
  | "BOOKING_INTENT"
  | "PURCHASE_INTENT"
  | "QUOTE_REQUESTED"
  | "PAYMENT_QUESTION"
  | "FOLLOW_UP_REQUESTED"
  | "OBJECTION"
  | "NO_LONGER_INTERESTED";

/** Runtime-checkable mirror of SignalType, for Zod schemas etc. (e.g. src/llm) that need
 * an actual value, not just a compile-time union. Single source of truth stays here —
 * do not redeclare these values elsewhere. */
export const SIGNAL_TYPES: SignalType[] = [
  "PRICING_REQUESTED",
  "AVAILABILITY_REQUESTED",
  "BOOKING_INTENT",
  "PURCHASE_INTENT",
  "QUOTE_REQUESTED",
  "PAYMENT_QUESTION",
  "FOLLOW_UP_REQUESTED",
  "OBJECTION",
  "NO_LONGER_INTERESTED",
];

export type InterestLevel = "LOW" | "MEDIUM" | "HIGH";

/** Runtime-checkable mirror of InterestLevel, see SIGNAL_TYPES above. */
export const INTEREST_LEVELS: InterestLevel[] = ["LOW", "MEDIUM", "HIGH"];
export type Priority = "LOW" | "MEDIUM" | "HIGH";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";
export type OpportunityState = "NEW" | "ENGAGED" | "HIGH_INTENT" | "AT_RISK";
export type NextBestAction =
  | "RESPOND"
  | "SEND_INFORMATION"
  | "ASK_QUESTION"
  | "OFFER_APPOINTMENT"
  | "FOLLOW_UP"
  | "WAIT"
  | "ESCALATE_TO_HUMAN";

export interface OpportunitySignalInput {
  type: SignalType;
  confidence?: number;
  sourceMessageId?: string;
}

/**
 * `lastInboundAt`/`lastOutboundAt` drive the Risk rule (Section "Risk Model"): risk must
 * be evaluable synchronously from data already persisted, with no scheduler/background
 * job in M2A. `now` is injectable for deterministic tests.
 */
export interface EvaluateOpportunityInput {
  interestLevel: InterestLevel;
  signals: OpportunitySignalInput[];
  lastInboundAt?: Date;
  lastOutboundAt?: Date;
  now?: Date;
}

export interface ScoreBreakdownEntry {
  signal: SignalType | "INTEREST_LEVEL";
  points: number;
}

export interface EvaluationResult {
  score: number;
  scoreBreakdown: ScoreBreakdownEntry[];
  priority: Priority;
  state: OpportunityState;
  stateReason: string;
  risk: RiskLevel;
  riskReason: string;
  nextBestAction: NextBestAction;
  actionReason: string;
  /**
   * NO_LONGER_INTERESTED override (see apps/api/README.md M2A section): when true, the
   * caller (OpportunitiesService) deactivates the Opportunity instead of leaving it
   * open. M2A has no terminal lifecycle state (WON/LOST/RECOVERED) — this is the MVP
   * substitute, documented as a simplification for a later milestone to replace.
   */
  deactivate: boolean;
}
