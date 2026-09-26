import type { ReasoningEffort } from "openai/resources/shared";
import { InterpretationError, LlmProvider } from "./commercial-interpreter";

/**
 * Env-driven LLM config (M2B). No provider/model/key/timeout is ever hardcoded in
 * business logic — see apps/api/.env.example for the placeholder vars. Resolved lazily
 * (called from each interpreter's interpret(), not at module bootstrap) so the API still
 * boots and M1/M2A still work with zero LLM env vars set; only an actual interpretation
 * call fails, safely, when config is missing/invalid. Each provider reads only its own
 * variables, so only the selected provider needs credentials.
 */
export const LLM_PROVIDERS: LlmProvider[] = ["openai", "jev"];

export interface OpenAiConfig {
  model: string;
  apiKey: string;
  timeoutMs: number;
  /** Unset keeps the original M2B request (temperature: 0, no reasoning_effort). */
  reasoningEffort?: ReasoningEffort;
}

export interface JevConfig {
  model: string;
  apiKey: string;
  /** Total budget for the call, retries included (the Jev SDK's own timeout is per attempt). */
  timeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

const OPENAI_REASONING_EFFORTS: NonNullable<ReasoningEffort>[] = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

/** Jev aliases move with each release — the comparison must pin a concrete version. */
const JEV_FLOATING_ALIASES = ["jev-latest", "jev-preview"];

export function resolveLlmProvider(): LlmProvider {
  const provider = process.env.LLM_PROVIDER;
  if (!provider) {
    throw new InterpretationError("MISSING_CONFIG", "LLM is not configured: LLM_PROVIDER must be set.");
  }
  if (!(LLM_PROVIDERS as string[]).includes(provider)) {
    throw new InterpretationError("INVALID_CONFIG", `Unsupported LLM_PROVIDER "${provider}" (expected one of: ${LLM_PROVIDERS.join(", ")}).`);
  }
  return provider as LlmProvider;
}

export function loadOpenAiConfig(): OpenAiConfig {
  // LLM_MODEL is the original M2B variable, kept as a deprecated fallback so existing
  // setups keep working.
  const model = process.env.OPENAI_MODEL || process.env.LLM_MODEL;
  const apiKey = process.env.OPENAI_API_KEY;

  if (!model || !apiKey) {
    throw new InterpretationError("MISSING_CONFIG", "OpenAI is not configured: OPENAI_MODEL (or legacy LLM_MODEL) and OPENAI_API_KEY must be set.");
  }

  const reasoningEffort = process.env.OPENAI_REASONING_EFFORT || undefined;
  if (reasoningEffort !== undefined && !(OPENAI_REASONING_EFFORTS as string[]).includes(reasoningEffort)) {
    throw new InterpretationError(
      "INVALID_CONFIG",
      `OPENAI_REASONING_EFFORT must be one of ${OPENAI_REASONING_EFFORTS.join(", ")}, got "${reasoningEffort}".`,
    );
  }

  return { model, apiKey, timeoutMs: loadTimeoutMs(), reasoningEffort: reasoningEffort as ReasoningEffort | undefined };
}

export function loadJevConfig(): JevConfig {
  const model = process.env.JEV_MODEL;
  const apiKey = process.env.TYPESAFE_API_KEY;

  if (!model || !apiKey) {
    throw new InterpretationError("MISSING_CONFIG", "Jev is not configured: JEV_MODEL and TYPESAFE_API_KEY must be set.");
  }
  if (JEV_FLOATING_ALIASES.includes(model)) {
    throw new InterpretationError("INVALID_CONFIG", `JEV_MODEL must be a pinned version (e.g. "jev-1.13.0"), not the alias "${model}".`);
  }

  return { model, apiKey, timeoutMs: loadTimeoutMs() };
}

function loadTimeoutMs(): number {
  const timeoutMs = process.env.LLM_TIMEOUT_MS ? Number(process.env.LLM_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new InterpretationError("INVALID_CONFIG", `LLM_TIMEOUT_MS must be a positive number, got "${process.env.LLM_TIMEOUT_MS}".`);
  }
  return timeoutMs;
}
