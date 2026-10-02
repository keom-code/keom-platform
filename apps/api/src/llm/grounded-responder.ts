import { CommercialContextMessage, CommercialIntent } from "./commercial-interpreter";
import { SignalType } from "../opportunities/opportunities.types";

/**
 * Provider-agnostic abstraction for drafting a suggested reply from retrieved knowledge
 * only (M3). Bound via the GROUNDED_RESPONDER DI token. It drafts text for a human seller —
 * it never sends anything, never decides score/priority/state/risk/next best action, and
 * may only state business facts that appear in the supplied sources.
 */
export const GROUNDED_RESPONDER = Symbol("GROUNDED_RESPONDER");

export interface GroundingSource {
  /** Short opaque id the model cites back, e.g. "S1". */
  id: string;
  title: string;
  content: string;
}

export interface GroundedResponseRequest {
  /** Bounded conversation (ContextBuilderService), oldest first. */
  messages: CommercialContextMessage[];
  sources: GroundingSource[];
  /** Optional M2B output, passed as context only. */
  interpretation?: { intent?: CommercialIntent; signals?: SignalType[] };
}

export interface GroundedResponderOutput {
  suggestedResponse: string | null;
  usedSourceIds: string[];
  insufficientKnowledge: boolean;
  requiresLiveVerification: boolean;
}

export interface GroundedResponder {
  respond(request: GroundedResponseRequest): Promise<GroundedResponderOutput>;
}

export type GroundedResponseErrorCode =
  | "MISSING_CONFIG"
  | "INVALID_CONFIG"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_ERROR"
  | "EMPTY_RESPONSE"
  | "INVALID_OUTPUT";

export class GroundedResponseError extends Error {
  constructor(
    public readonly code: GroundedResponseErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "GroundedResponseError";
  }
}
