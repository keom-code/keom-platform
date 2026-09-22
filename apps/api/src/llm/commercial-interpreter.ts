import { InterestLevel, SignalType } from "../opportunities/opportunities.types";

/**
 * Provider-agnostic abstraction (M2B): KEOM's business logic depends on this interface,
 * never on a specific SDK. "LLM interprets, engine decides" — this interpreter only
 * extracts structured commercial facts; it must never compute score/priority/state/risk/
 * nextBestAction, and it must never retrieve business knowledge (no RAG in M2B).
 */
export const COMMERCIAL_INTERPRETER = Symbol("COMMERCIAL_INTERPRETER");

export type CommercialIntent = "BOOKING" | "PRICING" | "INFORMATION" | "PURCHASE" | "OTHER";

export interface CommercialContextMessage {
  direction: "INBOUND" | "OUTBOUND";
  text: string;
  sentAt: Date;
}

/** Bounded, deterministic input to the interpreter — see ContextBuilderService for how
 * this is assembled (last N messages only, no full history, no prior Opportunity state). */
export interface CommercialContext {
  conversationId: string;
  messages: CommercialContextMessage[];
}

export interface CommercialInterpretation {
  intent: CommercialIntent;
  interestLevel: InterestLevel;
  signals: SignalType[];
  entities: {
    requestedDate?: string;
    requestedTime?: string;
    serviceName?: string;
    productName?: string;
  };
  /** Single overall confidence for this interpretation call (0-1) — M2B does not
   * request/track per-signal confidence yet (see apps/api/README.md M2B section). */
  confidence: number;
}

export interface CommercialInterpreter {
  interpret(context: CommercialContext): Promise<CommercialInterpretation>;
}

export type InterpretationErrorCode =
  | "MISSING_CONFIG"
  | "INVALID_CONFIG"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_ERROR"
  | "EMPTY_RESPONSE"
  | "INVALID_OUTPUT";

/** Thrown by any CommercialInterpreter implementation on any failure mode. Callers
 * (InterpretationService) must catch this and never mutate/persist Opportunity state
 * when it's thrown. */
export class InterpretationError extends Error {
  constructor(
    public readonly code: InterpretationErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "InterpretationError";
  }
}
