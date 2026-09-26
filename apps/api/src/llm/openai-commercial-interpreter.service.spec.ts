import OpenAI, { APIConnectionTimeoutError, APIError } from "openai";
import { CommercialContext, InterpretationError } from "./commercial-interpreter";
import { OpenAiCommercialInterpreter } from "./openai-commercial-interpreter.service";
import { OpenAiConfig } from "./llm.config";

/**
 * No real network/API calls: `createClient` is stubbed per test via subclassing (see
 * openai-commercial-interpreter.service.ts's `createClient` seam). Config is provided
 * via real env vars set/restored in beforeEach/afterEach.
 */
function fakeClient(create: jest.Mock): OpenAI {
  return { chat: { completions: { create } } } as unknown as OpenAI;
}

class TestableInterpreter extends OpenAiCommercialInterpreter {
  constructor(private readonly client: OpenAI) {
    super();
  }
  protected override createClient(_config: OpenAiConfig): OpenAI {
    return this.client;
  }
}

const context: CommercialContext = {
  conversationId: "conversation-1",
  messages: [{ direction: "INBOUND", text: "Hola, ¿cuánto cuesta?", sentAt: new Date("2026-01-01T00:00:00Z") }],
};

const originalEnv = { ...process.env };

describe("OpenAiCommercialInterpreter", () => {
  beforeEach(() => {
    process.env.LLM_PROVIDER = "openai";
    process.env.OPENAI_MODEL = "gpt-4o-mini";
    delete process.env.LLM_MODEL;
    delete process.env.OPENAI_REASONING_EFFORT;
    process.env.OPENAI_API_KEY = "test-key";
    process.env.LLM_TIMEOUT_MS = "10000";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns the validated interpretation on a well-formed JSON response", async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              intent: "PRICING",
              interestLevel: "MEDIUM",
              signals: ["PRICING_REQUESTED"],
              entities: {},
              confidence: 0.8,
            }),
          },
        },
      ],
      usage: { total_tokens: 42 },
    });
    const interpreter = new TestableInterpreter(fakeClient(create));

    const result = await interpreter.interpret(context);

    expect(result).toEqual({
      intent: "PRICING",
      interestLevel: "MEDIUM",
      signals: ["PRICING_REQUESTED"],
      entities: {},
      confidence: 0.8,
    });
  });

  it("throws MISSING_CONFIG when required env vars are absent", async () => {
    delete process.env.OPENAI_API_KEY;
    const interpreter = new TestableInterpreter(fakeClient(jest.fn()));

    await expect(interpreter.interpret(context)).rejects.toMatchObject({
      code: "MISSING_CONFIG",
    } satisfies Partial<InterpretationError>);
  });

  it("throws EMPTY_RESPONSE when the provider returns no content", async () => {
    const create = jest.fn().mockResolvedValue({ choices: [{ message: {} }] });
    const interpreter = new TestableInterpreter(fakeClient(create));

    await expect(interpreter.interpret(context)).rejects.toMatchObject({ code: "EMPTY_RESPONSE" });
  });

  it("throws INVALID_OUTPUT on non-JSON content", async () => {
    const create = jest.fn().mockResolvedValue({ choices: [{ message: { content: "not json" } }] });
    const interpreter = new TestableInterpreter(fakeClient(create));

    await expect(interpreter.interpret(context)).rejects.toMatchObject({ code: "INVALID_OUTPUT" });
  });

  it("throws INVALID_OUTPUT when the JSON does not match the schema (e.g. unsupported signal)", async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              intent: "PRICING",
              interestLevel: "MEDIUM",
              signals: ["MADE_UP_SIGNAL"],
              confidence: 0.5,
            }),
          },
        },
      ],
    });
    const interpreter = new TestableInterpreter(fakeClient(create));

    await expect(interpreter.interpret(context)).rejects.toMatchObject({ code: "INVALID_OUTPUT" });
  });

  it("throws PROVIDER_TIMEOUT when the SDK raises a connection timeout", async () => {
    const create = jest.fn().mockRejectedValue(new APIConnectionTimeoutError());
    const interpreter = new TestableInterpreter(fakeClient(create));

    await expect(interpreter.interpret(context)).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
  });

  it("throws PROVIDER_ERROR when the SDK raises a generic API error", async () => {
    const create = jest.fn().mockRejectedValue(new APIError(401, { message: "bad key" }, "Unauthorized", undefined));
    const interpreter = new TestableInterpreter(fakeClient(create));

    await expect(interpreter.interpret(context)).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });

  describe("request parameters", () => {
    const validResponse = {
      model: "gpt-4o-mini-2024-07-18",
      choices: [
        {
          message: {
            content: JSON.stringify({ intent: "OTHER", interestLevel: "LOW", signals: [], entities: {}, confidence: 0.9 }),
          },
        },
      ],
      usage: {
        prompt_tokens: 120,
        completion_tokens: 30,
        total_tokens: 150,
        prompt_tokens_details: { cached_tokens: 10 },
        completion_tokens_details: { reasoning_tokens: 0 },
      },
    };

    it("sends the original M2B request (temperature 0, no reasoning_effort) when OPENAI_REASONING_EFFORT is unset", async () => {
      const create = jest.fn().mockResolvedValue(validResponse);
      await new TestableInterpreter(fakeClient(create)).interpret(context);

      const params = create.mock.calls[0][0];
      expect(params).toMatchObject({ model: "gpt-4o-mini", temperature: 0, response_format: { type: "json_object" } });
      expect(params).not.toHaveProperty("reasoning_effort");
    });

    it("omits temperature when a reasoning effort other than none is configured", async () => {
      process.env.OPENAI_MODEL = "gpt-5.6-luna";
      process.env.OPENAI_REASONING_EFFORT = "low";
      const create = jest.fn().mockResolvedValue(validResponse);
      await new TestableInterpreter(fakeClient(create)).interpret(context);

      const params = create.mock.calls[0][0];
      expect(params).toMatchObject({ model: "gpt-5.6-luna", reasoning_effort: "low" });
      expect(params).not.toHaveProperty("temperature");
    });

    it("keeps temperature 0 alongside reasoning_effort none", async () => {
      process.env.OPENAI_REASONING_EFFORT = "none";
      const create = jest.fn().mockResolvedValue(validResponse);
      await new TestableInterpreter(fakeClient(create)).interpret(context);

      expect(create.mock.calls[0][0]).toMatchObject({ reasoning_effort: "none", temperature: 0 });
    });

    it("throws INVALID_CONFIG for an unknown OPENAI_REASONING_EFFORT, before calling the provider", async () => {
      process.env.OPENAI_REASONING_EFFORT = "turbo";
      const create = jest.fn();

      await expect(new TestableInterpreter(fakeClient(create)).interpret(context)).rejects.toMatchObject({ code: "INVALID_CONFIG" });
      expect(create).not.toHaveBeenCalled();
    });

    it("falls back to the legacy LLM_MODEL variable when OPENAI_MODEL is unset", async () => {
      delete process.env.OPENAI_MODEL;
      process.env.LLM_MODEL = "legacy-model";
      const create = jest.fn().mockResolvedValue(validResponse);
      await new TestableInterpreter(fakeClient(create)).interpret(context);

      expect(create.mock.calls[0][0]).toMatchObject({ model: "legacy-model" });
    });

    it("reports served model, latency and normalized usage via interpretWithDiagnostics", async () => {
      const create = jest.fn().mockResolvedValue(validResponse);
      const { diagnostics } = await new TestableInterpreter(fakeClient(create)).interpretWithDiagnostics(context);

      expect(diagnostics).toMatchObject({
        provider: "openai",
        model: "gpt-4o-mini-2024-07-18",
        usage: { inputTokens: 120, outputTokens: 30, cachedInputTokens: 10, reasoningTokens: 0 },
      });
      expect(diagnostics.latencyMs).toBeGreaterThanOrEqual(0);
    });
  });
});
