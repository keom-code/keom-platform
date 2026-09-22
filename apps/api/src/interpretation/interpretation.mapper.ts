import { CommercialInterpretation } from "../llm/commercial-interpreter";
import { EvaluateOpportunityRequest } from "../opportunities/opportunities.service";

/**
 * Thin, intentionally dumb mapper (M2B): does not compute or adjust anything the LLM or
 * M2A already own. `intent`/`entities` are deliberately dropped here — not persisted in
 * M2B (see apps/api/README.md M2B "Structured output"). `confidence` is applied
 * uniformly to every signal from this interpretation call (no per-signal confidence in
 * M2B). `sourceMessageId` is the conversation's latest inbound message, since the LLM
 * doesn't attribute individual signals to individual messages.
 */
export interface InterpretationMapperInput {
  companyId: string;
  customerId: string;
  conversationId: string;
  interpretation: CommercialInterpretation;
  lastInboundMessageId?: string;
  lastInboundAt?: Date;
  lastOutboundAt?: Date;
}

export function mapInterpretationToOpportunityInput(input: InterpretationMapperInput): EvaluateOpportunityRequest {
  return {
    companyId: input.companyId,
    customerId: input.customerId,
    conversationId: input.conversationId,
    interestLevel: input.interpretation.interestLevel,
    signals: input.interpretation.signals.map((type) => ({
      type,
      confidence: input.interpretation.confidence,
      sourceMessageId: input.lastInboundMessageId,
    })),
    lastInboundAt: input.lastInboundAt,
    lastOutboundAt: input.lastOutboundAt,
  };
}
