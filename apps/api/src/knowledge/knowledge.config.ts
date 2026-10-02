import { KnowledgeError } from "./knowledge.types";

/**
 * Env-driven retrieval defaults (M3), resolved lazily per call. Requests may override them
 * within the same bounds. The similarity threshold is model-specific: with
 * text-embedding-3-small, relevant matches scored 0.355-0.611 and unrelated ones 0.182-0.315
 * in the M3 manual demo, so 0.35 is the default (calibration table in apps/api/README.md M3
 * "Retrieval"). Recalibrate when the model or the content language mix changes.
 */
export const MAX_TOP_K = 20;
const DEFAULT_TOP_K = 5;
const DEFAULT_MIN_SIMILARITY = 0.35;

export interface KnowledgeRetrievalConfig {
  topK: number;
  minSimilarity: number;
}

export function loadKnowledgeRetrievalConfig(): KnowledgeRetrievalConfig {
  const topK = process.env.KNOWLEDGE_TOP_K ? Number(process.env.KNOWLEDGE_TOP_K) : DEFAULT_TOP_K;
  if (!Number.isInteger(topK) || topK < 1 || topK > MAX_TOP_K) {
    throw new KnowledgeError("INVALID_CONFIG", `KNOWLEDGE_TOP_K must be an integer between 1 and ${MAX_TOP_K}, got "${process.env.KNOWLEDGE_TOP_K}".`);
  }

  const minSimilarity = process.env.KNOWLEDGE_MIN_SIMILARITY ? Number(process.env.KNOWLEDGE_MIN_SIMILARITY) : DEFAULT_MIN_SIMILARITY;
  if (!Number.isFinite(minSimilarity) || minSimilarity < 0 || minSimilarity > 1) {
    throw new KnowledgeError("INVALID_CONFIG", `KNOWLEDGE_MIN_SIMILARITY must be a number between 0 and 1, got "${process.env.KNOWLEDGE_MIN_SIMILARITY}".`);
  }

  return { topK, minSimilarity };
}
