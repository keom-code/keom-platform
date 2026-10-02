import { Inject, Injectable } from "@nestjs/common";
import { EMBEDDING_PROVIDER, EmbeddingProvider } from "../llm/embedding-provider";
import { KnowledgeChunkRepository } from "./knowledge-chunk.repository";
import { loadKnowledgeRetrievalConfig } from "./knowledge.config";
import { KnowledgeError, KnowledgeRetrievalResult, KnowledgeSearchInput } from "./knowledge.types";
import { normalizeText } from "./text-normalizer";

/**
 * M3 retrieval: companyId + query -> query embedding -> company-scoped similarity search
 * -> top K -> similarity threshold. Generic on purpose: no industry branching, no
 * knowledge of metadata keys — it works from companyId, text, embeddings and an optional
 * opaque metadata containment filter only. Anything industry-specific belongs above this.
 *
 * Outcomes are distinguishable: chunks (relevant knowledge), an empty list (no relevant
 * knowledge), or a thrown EmbeddingError/KnowledgeError (retrieval failure).
 */
@Injectable()
export class KnowledgeRetrievalService {
  constructor(
    private readonly chunks: KnowledgeChunkRepository,
    @Inject(EMBEDDING_PROVIDER) private readonly embedder: EmbeddingProvider,
  ) {}

  async retrieve(input: KnowledgeSearchInput): Promise<KnowledgeRetrievalResult> {
    const defaults = loadKnowledgeRetrievalConfig();
    const topK = input.topK ?? defaults.topK;
    const minSimilarity = input.minSimilarity ?? defaults.minSimilarity;
    const query = normalizeText(input.query);
    if (!query) {
      return { query, topK, minSimilarity, chunks: [] };
    }

    const { model, vector } = await this.embedder.embed(query);

    let matches;
    try {
      matches = await this.chunks.search({
        companyId: input.companyId,
        embedding: vector,
        embeddingModel: model,
        topK,
        metadataFilter: input.metadataFilter,
      });
    } catch (err) {
      throw new KnowledgeError("RETRIEVAL_FAILED", "Knowledge similarity search failed.", err);
    }

    return { query, topK, minSimilarity, chunks: matches.filter((match) => match.similarity >= minSimilarity) };
  }
}
