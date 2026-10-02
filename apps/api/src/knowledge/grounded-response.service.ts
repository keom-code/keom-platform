import { Inject, Injectable, Logger } from "@nestjs/common";
import { CommercialInterpretation } from "../llm/commercial-interpreter";
import { GROUNDED_RESPONDER, GroundedResponder } from "../llm/grounded-responder";
import { ContextBuilderService } from "../interpretation/context-builder.service";
import { KnowledgeRetrievalService } from "./knowledge-retrieval.service";
import { RetrievedChunk } from "./knowledge.types";
import { buildRetrievalQuery } from "./retrieval-query";

/** Optional M2B output supplied by the caller; used as retrieval/prompt context only. */
export type SuggestionInterpretation = Partial<Pick<CommercialInterpretation, "intent" | "signals">> & {
  entities?: Pick<CommercialInterpretation["entities"], "serviceName" | "productName">;
};

export interface SuggestionSource {
  chunkId: string;
  documentId: string;
  title: string;
  sourceName: string | null;
  chunkIndex: number;
  similarity: number;
}

export interface SuggestedResponseResult {
  status: "GROUNDED" | "INSUFFICIENT_KNOWLEDGE";
  suggestedResponse: string | null;
  grounded: boolean;
  insufficientKnowledge: boolean;
  /** The customer asked for something only a live system could confirm (a specific slot,
   * stock, order status...). The suggestion, if any, states only the general rule. */
  requiresLiveVerification: boolean;
  retrievalQuery: string | null;
  /** Chunks the suggestion's facts came from. Empty unless GROUNDED. */
  sources: SuggestionSource[];
}

/**
 * Signals whose answer is live operational data, never static knowledge. Deterministic
 * floor for requiresLiveVerification so the flag doesn't depend on the LLM alone.
 */
const LIVE_DATA_SIGNALS = new Set(["AVAILABILITY_REQUESTED"]);

/**
 * M3 optional grounded suggestion: conversation -> bounded retrieval query -> company-scoped
 * retrieval -> GroundedResponder -> grounding checks. Drafts only: nothing is persisted,
 * nothing is sent, M2A is never called and no commercial decision is made here.
 *
 * Grounding contract (see apps/api/README.md M3):
 * - No relevant chunks -> INSUFFICIENT_KNOWLEDGE without calling the LLM at all, so there is
 *   nothing that could invent a fact.
 * - The LLM must cite which sources it used; a suggestion citing no source, or an id that was
 *   not retrieved, is discarded as INSUFFICIENT_KNOWLEDGE.
 * - Retrieval/provider failures throw (HTTP 5xx), so "insufficient knowledge" and "failure"
 *   are never confused downstream.
 */
@Injectable()
export class GroundedResponseService {
  private readonly logger = new Logger(GroundedResponseService.name);

  constructor(
    private readonly contextBuilder: ContextBuilderService,
    private readonly retrieval: KnowledgeRetrievalService,
    @Inject(GROUNDED_RESPONDER) private readonly responder: GroundedResponder,
  ) {}

  async suggest(conversationId: string, interpretation?: SuggestionInterpretation): Promise<SuggestedResponseResult> {
    // companyId comes from the conversation row, never from the caller.
    const built = await this.contextBuilder.build(conversationId);
    const liveDataSignal = (interpretation?.signals ?? []).some((signal) => LIVE_DATA_SIGNALS.has(signal));

    const retrievalQuery = buildRetrievalQuery(built.context.messages, interpretation?.entities);
    if (!retrievalQuery) {
      return insufficient(null, liveDataSignal);
    }

    const { chunks } = await this.retrieval.retrieve({ companyId: built.companyId, query: retrievalQuery });
    if (chunks.length === 0) {
      this.logger.log(`No relevant knowledge for conversationId=${conversationId}; LLM not called`);
      return insufficient(retrievalQuery, liveDataSignal);
    }

    const byId = new Map(chunks.map((chunk, index) => [`S${index + 1}`, chunk]));
    const output = await this.responder.respond({
      messages: built.context.messages,
      sources: [...byId].map(([id, chunk]) => ({ id, title: chunk.title, content: chunk.content })),
      interpretation: interpretation && { intent: interpretation.intent, signals: interpretation.signals },
    });
    const requiresLiveVerification = output.requiresLiveVerification || liveDataSignal;

    const citedIds = [...new Set(output.usedSourceIds)];
    const unknownIds = citedIds.filter((id) => !byId.has(id));
    if (output.insufficientKnowledge || !output.suggestedResponse || citedIds.length === 0 || unknownIds.length > 0) {
      if (unknownIds.length > 0) {
        this.logger.warn(`Discarded suggestion citing unknown sources ${unknownIds.join(", ")} for conversationId=${conversationId}`);
      }
      return insufficient(retrievalQuery, requiresLiveVerification);
    }

    return {
      status: "GROUNDED",
      suggestedResponse: output.suggestedResponse,
      grounded: true,
      insufficientKnowledge: false,
      requiresLiveVerification,
      retrievalQuery,
      sources: citedIds.map((id) => toSource(byId.get(id)!)),
    };
  }
}

function insufficient(retrievalQuery: string | null, requiresLiveVerification: boolean): SuggestedResponseResult {
  return {
    status: "INSUFFICIENT_KNOWLEDGE",
    suggestedResponse: null,
    grounded: false,
    insufficientKnowledge: true,
    requiresLiveVerification,
    retrievalQuery,
    sources: [],
  };
}

function toSource(chunk: RetrievedChunk): SuggestionSource {
  return {
    chunkId: chunk.chunkId,
    documentId: chunk.documentId,
    title: chunk.title,
    sourceName: chunk.sourceName,
    chunkIndex: chunk.chunkIndex,
    similarity: chunk.similarity,
  };
}
