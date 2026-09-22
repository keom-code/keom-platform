import { InterpretationError } from "./commercial-interpreter";

/**
 * Env-driven LLM config (M2B). No provider/model/key/timeout is ever hardcoded in
 * business logic — see apps/api/.env.example for the placeholder vars. Resolved lazily
 * (called from OpenAiCommercialInterpreter.interpret(), not at module bootstrap) so the
 * API still boots and M1/M2A still work with zero LLM env vars set; only an actual
 * interpretation call fails, safely, when config is missing/invalid.
 */
export interface LlmConfig {
  provider: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export function loadLlmConfig(): LlmConfig {
  const provider = process.env.LLM_PROVIDER;
  const model = process.env.LLM_MODEL;
  const apiKey = process.env.OPENAI_API_KEY;

  if (!provider || !model || !apiKey) {
    throw new InterpretationError(
      "MISSING_CONFIG",
      "LLM is not configured: LLM_PROVIDER, LLM_MODEL and OPENAI_API_KEY must all be set.",
    );
  }

  if (provider !== "openai") {
    throw new InterpretationError("INVALID_CONFIG", `Unsupported LLM_PROVIDER "${provider}" (only "openai" is implemented in M2B).`);
  }

  const timeoutMs = process.env.LLM_TIMEOUT_MS ? Number(process.env.LLM_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new InterpretationError("INVALID_CONFIG", `LLM_TIMEOUT_MS must be a positive number, got "${process.env.LLM_TIMEOUT_MS}".`);
  }

  return { provider, model, apiKey, timeoutMs };
}
