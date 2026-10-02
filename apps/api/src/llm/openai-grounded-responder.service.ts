import { Injectable } from "@nestjs/common";
import OpenAI, { APIConnectionTimeoutError, APIError } from "openai";
import type { ChatCompletion, ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import { InterpretationError } from "./commercial-interpreter";
import { GroundedResponderOutput, GroundedResponder, GroundedResponseError, GroundedResponseRequest } from "./grounded-responder";
import { buildGroundedResponseUserPrompt, GROUNDED_RESPONSE_SYSTEM_PROMPT } from "./grounded-response.prompt";
import { GroundedResponderOutputSchema } from "./grounded-response.schema";
import { loadOpenAiConfig, OpenAiConfig } from "./llm.config";

/**
 * OpenAI GroundedResponder (M3). Reuses M2B's OpenAI config (OPENAI_MODEL, OPENAI_API_KEY,
 * LLM_TIMEOUT_MS, OPENAI_REASONING_EFFORT) and its request shape: JSON mode, temperature 0
 * unless a reasoning effort other than "none" is set. OpenAI-only regardless of
 * LLM_PROVIDER — Jev is a classifier and cannot draft text. Zod is the validation gate.
 */
@Injectable()
export class OpenAiGroundedResponder implements GroundedResponder {
  async respond(request: GroundedResponseRequest): Promise<GroundedResponderOutput> {
    const config = this.loadConfig();
    const completion = await this.requestCompletion(this.createClient(config), config, request);

    const rawContent = completion.choices[0]?.message?.content;
    if (!rawContent) {
      throw new GroundedResponseError("EMPTY_RESPONSE", "LLM provider returned an empty response.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawContent);
    } catch (err) {
      throw new GroundedResponseError("INVALID_OUTPUT", "LLM provider returned non-JSON output.", err);
    }
    const result = GroundedResponderOutputSchema.safeParse(parsed);
    if (!result.success) {
      throw new GroundedResponseError("INVALID_OUTPUT", `Grounded response failed schema validation: ${result.error.message}`, result.error);
    }
    return result.data;
  }

  /** Extracted so tests can override this one seam (subclass + stub), as in M2B. */
  protected createClient(config: OpenAiConfig): OpenAI {
    return new OpenAI({ apiKey: config.apiKey, timeout: config.timeoutMs });
  }

  private loadConfig(): OpenAiConfig {
    try {
      return loadOpenAiConfig();
    } catch (err) {
      if (err instanceof InterpretationError && (err.code === "MISSING_CONFIG" || err.code === "INVALID_CONFIG")) {
        throw new GroundedResponseError(err.code, err.message, err);
      }
      throw err;
    }
  }

  private async requestCompletion(client: OpenAI, config: OpenAiConfig, request: GroundedResponseRequest): Promise<ChatCompletion> {
    const params: ChatCompletionCreateParamsNonStreaming = {
      model: config.model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: GROUNDED_RESPONSE_SYSTEM_PROMPT },
        { role: "user", content: buildGroundedResponseUserPrompt(request) },
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
        throw new GroundedResponseError("PROVIDER_TIMEOUT", "LLM provider request timed out.", err);
      }
      if (err instanceof APIError) {
        throw new GroundedResponseError("PROVIDER_ERROR", `LLM provider request failed: ${err.message}`, err);
      }
      throw new GroundedResponseError("PROVIDER_ERROR", "LLM provider request failed.", err);
    }
  }
}
