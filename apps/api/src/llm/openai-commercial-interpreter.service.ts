import { Injectable, Logger } from "@nestjs/common";
import OpenAI, { APIConnectionTimeoutError, APIError } from "openai";
import { CommercialInterpretationSchema } from "./commercial-interpretation.schema";
import { CommercialContext, CommercialInterpretation, CommercialInterpreter, InterpretationError } from "./commercial-interpreter";
import { loadLlmConfig, LlmConfig } from "./llm.config";
import { buildUserPrompt, SYSTEM_PROMPT } from "./prompt";

/**
 * Only concrete CommercialInterpreter implementation in M2B. Uses Chat Completions'
 * `response_format: json_object` (not strict provider-side `json_schema` mode) to avoid
 * an extra schema-conversion dependency — Zod (CommercialInterpretationSchema) remains
 * the actual validation boundary regardless of what the provider claims to guarantee,
 * per the M2B sign-off. temperature: 0 and a short prompt keep this cheap and consistent
 * (no chain-of-thought, no RAG/business-knowledge retrieval).
 */
@Injectable()
export class OpenAiCommercialInterpreter implements CommercialInterpreter {
  private readonly logger = new Logger(OpenAiCommercialInterpreter.name);

  async interpret(context: CommercialContext): Promise<CommercialInterpretation> {
    const config = loadLlmConfig();
    const client = this.createClient(config);

    const completion = await this.requestCompletion(client, config.model, context);

    const rawContent = completion.choices[0]?.message?.content;
    if (!rawContent) {
      throw new InterpretationError("EMPTY_RESPONSE", "LLM provider returned an empty response.");
    }

    if (completion.usage) {
      this.logger.debug(`Token usage: ${JSON.stringify(completion.usage)}`);
    }

    return this.parseAndValidate(rawContent);
  }

  /** Extracted so tests can override this one seam (subclass + stub) instead of
   * mocking the `openai` module's internals. */
  protected createClient(config: LlmConfig): OpenAI {
    return new OpenAI({ apiKey: config.apiKey, timeout: config.timeoutMs });
  }

  private async requestCompletion(client: OpenAI, model: string, context: CommercialContext) {
    try {
      return await client.chat.completions.create({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(context) },
        ],
      });
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

  private parseAndValidate(rawContent: string): CommercialInterpretation {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawContent);
    } catch (err) {
      throw new InterpretationError("INVALID_OUTPUT", "LLM provider returned non-JSON output.", err);
    }

    const result = CommercialInterpretationSchema.safeParse(parsedJson);
    if (!result.success) {
      throw new InterpretationError("INVALID_OUTPUT", `LLM output failed schema validation: ${result.error.message}`, result.error);
    }

    return result.data;
  }
}
