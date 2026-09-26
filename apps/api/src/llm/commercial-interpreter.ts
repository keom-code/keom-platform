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

export type LlmProvider = "openai" | "jev";

/** Provider-reported token usage, normalized for the offline evaluation's cost estimate.
 * Neither provider reports a monetary cost per request — cost is always estimated. */
export interface InterpretationUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
}

/** Observability for one provider call. Used by the offline evaluation runner
 * (apps/api/evals) — never persisted, never fed to M2A. `raw` holds provider-specific
 * evidence (e.g. Jev's per-question probabilities), never conversation text. */
export interface InterpretationDiagnostics {
  provider: LlmProvider;
  model: string;
  latencyMs: number;
  usage?: InterpretationUsage;
  raw?: unknown;
}

export interface DiagnosedInterpretation {
  interpretation: CommercialInterpretation;
  diagnostics: InterpretationDiagnostics;
}

/** Implemented by every concrete provider so the evaluation runner can read usage/latency
 * without widening CommercialInterpreter itself. */
export interface DiagnosableCommercialInterpreter extends CommercialInterpreter {
  interpretWithDiagnostics(context: CommercialContext): Promise<DiagnosedInterpretation>;
}

export type InterpretationErrorCode =
  | "MISSING_CONFIG"
  | "INVALID_CONFIG"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_ERROR"
  | "EMPTY_RESPONSE"
  | "INVALID_OUTPUT"
  /** The provider answered, but not confidently enough to act on (e.g. a Jev probability
   * inside a signal's uncertainty band). Deliberately distinct from both a successful
   * "no signals" interpretation and a provider failure. */
  | "UNCERTAIN_OUTPUT";

/** Thrown by any CommercialInterpreter implementation on any failure mode. Callers
 * (InterpretationService) must catch this and never mutate/persist Opportunity state
 * when it's thrown. */
export class InterpretationError extends Error {
  constructor(
    public readonly code: InterpretationErrorCode,
    message: string,
    public readonly cause?: unknown,
    /** Set when the provider did respond (e.g. UNCERTAIN_OUTPUT), so the evaluation
     * runner can still report latency/usage/raw evidence for the failed case. */
    public readonly diagnostics?: InterpretationDiagnostics,
  ) {
    super(message);
    this.name = "InterpretationError";
  }
}
