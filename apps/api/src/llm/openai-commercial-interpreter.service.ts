import { Injectable, Logger } from "@nestjs/common";
import OpenAI, { APIConnectionTimeoutError, APIError } from "openai";
import type { ChatCompletion, ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import { CommercialInterpretationSchema } from "./commercial-interpretation.schema";
import {
  CommercialContext,
  CommercialInterpretation,
  DiagnosableCommercialInterpreter,
  DiagnosedInterpretation,
  InterpretationDiagnostics,
  InterpretationError,
  InterpretationUsage,
} from "./commercial-interpreter";
import { loadOpenAiConfig, OpenAiConfig } from "./llm.config";
import { buildUserPrompt, SYSTEM_PROMPT } from "./prompt";

/**
 * OpenAI CommercialInterpreter implementation. Uses Chat Completions'
 * `response_format: json_object` (not strict provider-side `json_schema` mode) to avoid
 * an extra schema-conversion dependency — Zod (CommercialInterpretationSchema) remains
 * the actual validation boundary regardless of what the provider claims to guarantee,
 * per the M2B sign-off. temperature: 0 and a short prompt keep this cheap and consistent
 * (no chain-of-thought, no RAG/business-knowledge retrieval). Reasoning models (e.g.
 * gpt-5.6-luna) reject `temperature` unless reasoning effort is "none", so when
 * OPENAI_REASONING_EFFORT is set, temperature is only sent alongside "none".
 */
@Injectable()
export class OpenAiCommercialInterpreter implements DiagnosableCommercialInterpreter {
  private readonly logger = new Logger(OpenAiCommercialInterpreter.name);

  async interpret(context: CommercialContext): Promise<CommercialInterpretation> {
    return (await this.interpretWithDiagnostics(context)).interpretation;
  }

  async interpretWithDiagnostics(context: CommercialContext): Promise<DiagnosedInterpretation> {
    const config = loadOpenAiConfig();
    const client = this.createClient(config);

    const startedAt = Date.now();
    const completion = await this.requestCompletion(client, config, context);
    const latencyMs = Date.now() - startedAt;

    const diagnostics: InterpretationDiagnostics = {
      provider: "openai",
      model: completion.model ?? config.model,
      latencyMs,
      usage: this.toUsage(completion.usage),
    };

    if (completion.usage) {
      this.logger.debug(`Token usage: ${JSON.stringify(completion.usage)}`);
    }

    const rawContent = completion.choices[0]?.message?.content;
    if (!rawContent) {
      throw new InterpretationError("EMPTY_RESPONSE", "LLM provider returned an empty response.", undefined, diagnostics);
    }

    return { interpretation: this.parseAndValidate(rawContent, diagnostics), diagnostics };
  }

  /** Extracted so tests can override this one seam (subclass + stub) instead of
   * mocking the `openai` module's internals. */
  protected createClient(config: OpenAiConfig): OpenAI {
    return new OpenAI({ apiKey: config.apiKey, timeout: config.timeoutMs });
  }

  private async requestCompletion(client: OpenAI, config: OpenAiConfig, context: CommercialContext): Promise<ChatCompletion> {
    const params: ChatCompletionCreateParamsNonStreaming = {
      model: config.model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(context) },
      ],
    };
    if (config.reasoningEffort) {
      params.reasoning_effort = config.reasoningEffort;
    }
    if (!config.reasoningEffort || config.reasoningEffort === "none") {
      params.temperature = 0;
    }

    try {
      return await client.chat.completions.create(params);
    } catch (err) {
      if (err instanceof APIConnectionTimeoutError) {
        throw new InterpretationError("PROVIDER_TIMEOUT", "LLM provider request timed out.", err);
      }
      if (err instanceof APIError) {
        throw new InterpretationError("PROVIDER_ERROR", `LLM provider request failed: ${err.message}`, err);
      }
      throw new InterpretationError("PROVIDER_ERROR", "LLM provider request failed.", err);
    }
  }

  private toUsage(usage: ChatCompletion["usage"]): InterpretationUsage | undefined {
    if (!usage) return undefined;
    return {
      inputTokens: usage.prompt_tokens,
      outputTokens: usage.completion_tokens,
      cachedInputTokens: usage.prompt_tokens_details?.cached_tokens,
      reasoningTokens: usage.completion_tokens_details?.reasoning_tokens,
    };
  }

  private parseAndValidate(rawContent: string, diagnostics: InterpretationDiagnostics): CommercialInterpretation {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawContent);
    } catch (err) {
      throw new InterpretationError("INVALID_OUTPUT", "LLM provider returned non-JSON output.", err, diagnostics);
    }

    const result = CommercialInterpretationSchema.safeParse(parsedJson);
    if (!result.success) {
      throw new InterpretationError("INVALID_OUTPUT", `LLM output failed schema validation: ${result.error.message}`, result.error, diagnostics);
    }

    return result.data;
  }
}
