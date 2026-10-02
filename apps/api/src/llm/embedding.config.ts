import { EmbeddingError, EmbeddingProviderName } from "./embedding-provider";

/**
 * Env-driven embedding config (M3), resolved lazily per call like llm.config.ts — the API
 * boots and M1/M2A/M2B work with no embedding variables set; only knowledge ingestion and
 * retrieval fail, safely, when config is missing or invalid. See apps/api/.env.example.
 */
export const EMBEDDING_PROVIDERS: EmbeddingProviderName[] = ["openai"];

export interface OpenAiEmbeddingConfig {
  model: string;
  apiKey: string;
  timeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export function resolveEmbeddingProvider(): EmbeddingProviderName {
  const provider = process.env.EMBEDDING_PROVIDER;
  if (!provider) {
    throw new EmbeddingError("MISSING_CONFIG", "Embeddings are not configured: EMBEDDING_PROVIDER must be set.");
  }
  if (!(EMBEDDING_PROVIDERS as string[]).includes(provider)) {
    throw new EmbeddingError(
      "INVALID_CONFIG",
      `Unsupported EMBEDDING_PROVIDER "${provider}" (expected one of: ${EMBEDDING_PROVIDERS.join(", ")}).`,
    );
  }
  return provider as EmbeddingProviderName;
}

export function loadOpenAiEmbeddingConfig(): OpenAiEmbeddingConfig {
  const model = process.env.OPENAI_EMBEDDING_MODEL;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!model || !apiKey) {
    throw new EmbeddingError("MISSING_CONFIG", "OpenAI embeddings are not configured: OPENAI_EMBEDDING_MODEL and OPENAI_API_KEY must be set.");
  }
  return { model, apiKey, timeoutMs: loadTimeoutMs() };
}

/** EMBEDDING_TIMEOUT_MS, falling back to the shared LLM_TIMEOUT_MS. */
function loadTimeoutMs(): number {
  const raw = process.env.EMBEDDING_TIMEOUT_MS || process.env.LLM_TIMEOUT_MS;
  const timeoutMs = raw ? Number(raw) : DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new EmbeddingError("INVALID_CONFIG", `EMBEDDING_TIMEOUT_MS (or LLM_TIMEOUT_MS) must be a positive number, got "${raw}".`);
  }
  return timeoutMs;
}
