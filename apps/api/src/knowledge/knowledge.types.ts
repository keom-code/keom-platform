/**
 * Shapes for the M3 Business Knowledge layer. Industry-agnostic by design: there are no
 * domain fields here (no price/schedule/product columns) — business-specific labels live
 * in free-form `KnowledgeMetadata`, which core retrieval never interprets beyond an
 * optional generic containment filter.
 */

export type KnowledgeSourceType = "TEXT" | "MARKDOWN";

export const KNOWLEDGE_SOURCE_TYPES: KnowledgeSourceType[] = ["TEXT", "MARKDOWN"];

/** Flat, free-form labels, e.g. { category: "pricing", language: "es" }. Keys differ per
 * company; nothing in the core depends on any specific key. */
export type KnowledgeMetadata = Record<string, string | number | boolean>;

/** Hard limits that keep synchronous ingestion bounded (one request = one embeddings call
 * series + one transaction). */
export const MAX_DOCUMENT_CHARS = 100_000;
export const MAX_CHUNKS_PER_DOCUMENT = 200;

export interface KnowledgeDocumentInput {
  companyId: string;
  title: string;
  content: string;
  sourceType?: KnowledgeSourceType;
  sourceName?: string;
  metadata?: KnowledgeMetadata;
}

export interface KnowledgeDocumentSummary {
  id: string;
  companyId: string;
  title: string;
  sourceType: KnowledgeSourceType;
  sourceName: string | null;
  metadata: KnowledgeMetadata;
  chunkCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeDocumentDetail extends KnowledgeDocumentSummary {
  content: string;
}

export interface IngestionResult {
  document: KnowledgeDocumentSummary;
  /** false when an identical document (same title + normalized content) already existed
   * for this company and was returned instead of being re-indexed. */
  created: boolean;
}

export interface KnowledgeSearchInput {
  companyId: string;
  query: string;
  topK?: number;
  minSimilarity?: number;
  metadataFilter?: KnowledgeMetadata;
}

/** One retrieved chunk with full source traceability. */
export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  title: string;
  sourceName: string | null;
  chunkIndex: number;
  content: string;
  /** Cosine similarity, 1 = identical direction. */
  similarity: number;
  metadata: KnowledgeMetadata;
}

export interface KnowledgeRetrievalResult {
  query: string;
  topK: number;
  minSimilarity: number;
  /** Ordered by similarity, highest first; only chunks >= minSimilarity. Empty means "no
   * relevant knowledge", not a failure — failures throw. */
  chunks: RetrievedChunk[];
}

export type KnowledgeErrorCode =
  | "COMPANY_NOT_FOUND"
  | "DOCUMENT_NOT_FOUND"
  | "EMPTY_CONTENT"
  | "CONTENT_TOO_LARGE"
  /** PUT would make this document identical to another of the company's documents. */
  | "DUPLICATE_CONTENT"
  | "INVALID_CONFIG"
  | "RETRIEVAL_FAILED"
  | "STORAGE_FAILED";

export class KnowledgeError extends Error {
  constructor(
    public readonly code: KnowledgeErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "KnowledgeError";
  }
}
