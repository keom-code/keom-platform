import OpenAI, { APIConnectionTimeoutError } from "openai";
import { GroundedResponseError, GroundedResponseRequest } from "./grounded-responder";
import { OpenAiConfig } from "./llm.config";
import { OpenAiGroundedResponder } from "./openai-grounded-responder.service";

function fakeClient(create: jest.Mock): OpenAI {
  return { chat: { completions: { create } } } as unknown as OpenAI;
}

class TestableResponder extends OpenAiGroundedResponder {
  constructor(private readonly client: OpenAI) {
    super();
  }
  protected override createClient(_config: OpenAiConfig): OpenAI {
    return this.client;
  }
}

function completion(content: unknown) {
  return jest.fn().mockResolvedValue({ choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] });
}

const request: GroundedResponseRequest = {
  messages: [{ direction: "INBOUND", text: "¿Cuánto cuesta?", sentAt: new Date("2026-01-01T00:00:00Z") }],
  sources: [{ id: "S1", title: "Laser FAQ", content: "Laser hair removal for legs costs S/320 per session." }],
  interpretation: { intent: "PRICING", signals: ["PRICING_REQUESTED"] },
};

const originalEnv = { ...process.env };

describe("OpenAiGroundedResponder", () => {
  beforeEach(() => {
    process.env.OPENAI_MODEL = "gpt-4o-mini";
    process.env.OPENAI_API_KEY = "test-key";
    delete process.env.LLM_MODEL;
    delete process.env.OPENAI_REASONING_EFFORT;
    delete process.env.LLM_TIMEOUT_MS;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("sends sources and conversation, and returns the validated output", async () => {
    const create = completion({ suggestedResponse: "Cuesta S/320 por sesión.", usedSourceIds: ["S1"], insufficientKnowledge: false, requiresLiveVerification: false });
    const result = await new TestableResponder(fakeClient(create)).respond(request);

    expect(result).toEqual({ suggestedResponse: "Cuesta S/320 por sesión.", usedSourceIds: ["S1"], insufficientKnowledge: false, requiresLiveVerification: false });
    const params = create.mock.calls[0][0];
    expect(params).toMatchObject({ model: "gpt-4o-mini", temperature: 0, response_format: { type: "json_object" } });
    expect(params.messages[1].content).toContain("[S1] Laser FAQ\nLaser hair removal for legs costs S/320 per session.");
    expect(params.messages[1].content).toContain("[CUSTOMER] ¿Cuánto cuesta?");
    expect(params.messages[1].content).toContain("signals=PRICING_REQUESTED");
  });

  it("maps missing config to MISSING_CONFIG without calling the provider", async () => {
    delete process.env.OPENAI_API_KEY;
    const create = completion({});
    await expect(new TestableResponder(fakeClient(create)).respond(request)).rejects.toMatchObject({ code: "MISSING_CONFIG" });
    expect(create).not.toHaveBeenCalled();
  });

  it("maps a timeout to PROVIDER_TIMEOUT", async () => {
    const create = jest.fn().mockRejectedValue(new APIConnectionTimeoutError());
    await expect(new TestableResponder(fakeClient(create)).respond(request)).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
  });

  it("rejects empty, non-JSON and schema-invalid output", async () => {
    await expect(new TestableResponder(fakeClient(completion(""))).respond(request)).rejects.toMatchObject({ code: "EMPTY_RESPONSE" });
    await expect(new TestableResponder(fakeClient(completion("not json"))).respond(request)).rejects.toMatchObject({ code: "INVALID_OUTPUT" });
    await expect(
      new TestableResponder(fakeClient(completion({ suggestedResponse: "x", usedSourceIds: ["chunk-uuid"], insufficientKnowledge: false, requiresLiveVerification: false }))).respond(
        request,
      ),
    ).rejects.toBeInstanceOf(GroundedResponseError);
  });
});
