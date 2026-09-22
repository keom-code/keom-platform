import OpenAI, { APIConnectionTimeoutError, APIError } from "openai";
import { CommercialContext, InterpretationError } from "./commercial-interpreter";
import { OpenAiCommercialInterpreter } from "./openai-commercial-interpreter.service";
import { LlmConfig } from "./llm.config";

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
  protected override createClient(_config: LlmConfig): OpenAI {
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
    process.env.LLM_MODEL = "gpt-4o-mini";
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
});
