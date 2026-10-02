/**
 * Provider-agnostic embedding abstraction (M3). src/knowledge depends on this interface via
 * the EMBEDDING_PROVIDER DI token, never on a specific SDK. Every result carries the model
 * that produced it so stored vectors are stamped with it (KnowledgeChunk.embeddingModel)
 * and vectors from different models are never compared.
 */
export const EMBEDDING_PROVIDER = Symbol("EMBEDDING_PROVIDER");

/**
 * Must match the `vector(1536)` column in prisma/schema.prisma (KnowledgeChunk.embedding).
 * 1536 is text-embedding-3-small's native output size, and it is requested explicitly via
 * the `dimensions` parameter. Changing it needs a migration plus re-embedding every
 * document — see apps/api/README.md M3.
 */
export const KNOWLEDGE_EMBEDDING_DIMENSIONS = 1536;

export interface Embedding {
  model: string;
  vector: number[];
}

export interface EmbeddingBatch {
  model: string;
  /** Same order and length as the input texts. */
  vectors: number[][];
}

export interface EmbeddingProvider {
  embed(text: string): Promise<Embedding>;
  embedMany(texts: string[]): Promise<EmbeddingBatch>;
}

export type EmbeddingProviderName = "openai";

export type EmbeddingErrorCode =
  | "MISSING_CONFIG"
  | "INVALID_CONFIG"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_ERROR"
  /** Wrong count, wrong dimensions, or non-finite values. */
  | "INVALID_OUTPUT";

/** Thrown by any EmbeddingProvider on any failure. Callers embed before writing anything,
 * so this is always a no-mutation failure (see KnowledgeDocumentsService). */
export class EmbeddingError extends Error {
  constructor(
    public readonly code: EmbeddingErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "EmbeddingError";
  }
}
