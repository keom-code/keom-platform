import { Test } from "@nestjs/testing";
import { COMMERCIAL_INTERPRETER, CommercialContext, CommercialInterpreter } from "./commercial-interpreter";
import { JevCommercialInterpreter } from "./jev-commercial-interpreter.service";
import { LlmModule } from "./llm.module";
import { OpenAiCommercialInterpreter } from "./openai-commercial-interpreter.service";

const context: CommercialContext = { conversationId: "conversation-1", messages: [] };
const originalEnv = { ...process.env };

/** Boots the real LlmModule with both providers' interpret() stubbed — verifies DI wiring
 * and per-call selection without any SDK/network involvement. */
describe("ProviderSelectingInterpreter (via COMMERCIAL_INTERPRETER)", () => {
  let interpreter: CommercialInterpreter;
  let openai: { interpret: jest.Mock };
  let jev: { interpret: jest.Mock };

  beforeEach(async () => {
    for (const key of ["LLM_PROVIDER", "OPENAI_API_KEY", "OPENAI_MODEL", "LLM_MODEL", "TYPESAFE_API_KEY", "JEV_MODEL"]) {
      delete process.env[key];
    }
    openai = { interpret: jest.fn().mockResolvedValue("openai-result") };
    jev = { interpret: jest.fn().mockResolvedValue("jev-result") };

    const moduleRef = await Test.createTestingModule({ imports: [LlmModule] })
      .overrideProvider(OpenAiCommercialInterpreter)
      .useValue(openai)
      .overrideProvider(JevCommercialInterpreter)
      .useValue(jev)
      .compile();
    interpreter = moduleRef.get(COMMERCIAL_INTERPRETER);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("resolves the module with no LLM env vars at all (lazy config: the API still boots)", () => {
    expect(interpreter).toBeDefined();
  });

  it("delegates to OpenAI when LLM_PROVIDER=openai", async () => {
    process.env.LLM_PROVIDER = "openai";

    await expect(interpreter.interpret(context)).resolves.toBe("openai-result");
    expect(jev.interpret).not.toHaveBeenCalled();
  });

  it("delegates to Jev when LLM_PROVIDER=jev", async () => {
    process.env.LLM_PROVIDER = "jev";

    await expect(interpreter.interpret(context)).resolves.toBe("jev-result");
    expect(openai.interpret).not.toHaveBeenCalled();
  });

  it("reads LLM_PROVIDER per call, so switching needs no restart of the module", async () => {
    process.env.LLM_PROVIDER = "openai";
    await interpreter.interpret(context);
    process.env.LLM_PROVIDER = "jev";
    await interpreter.interpret(context);

    expect(openai.interpret).toHaveBeenCalledTimes(1);
    expect(jev.interpret).toHaveBeenCalledTimes(1);
  });

  it("throws MISSING_CONFIG when LLM_PROVIDER is unset, calling neither provider", async () => {
    await expect(interpreter.interpret(context)).rejects.toMatchObject({ code: "MISSING_CONFIG" });
    expect(openai.interpret).not.toHaveBeenCalled();
    expect(jev.interpret).not.toHaveBeenCalled();
  });

  it("throws INVALID_CONFIG for an unsupported LLM_PROVIDER", async () => {
    process.env.LLM_PROVIDER = "anthropic";

    await expect(interpreter.interpret(context)).rejects.toMatchObject({ code: "INVALID_CONFIG" });
  });

  it("does not fall back to the other provider when the selected one fails", async () => {
    process.env.LLM_PROVIDER = "jev";
    jev.interpret.mockRejectedValue(new Error("jev down"));

    await expect(interpreter.interpret(context)).rejects.toThrow("jev down");
    expect(openai.interpret).not.toHaveBeenCalled();
  });
});
