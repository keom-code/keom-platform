import { Test } from "@nestjs/testing";
import { COMMERCIAL_INTERPRETER, CommercialInterpretation, InterpretationError } from "../llm/commercial-interpreter";
import { OpportunitiesService } from "../opportunities/opportunities.service";
import { ContextBuilderService } from "./context-builder.service";
import { InterpretationService } from "./interpretation.service";

const CONVERSATION_ID = "conversation-1";

const builtContext = {
  companyId: "company-1",
  customerId: "customer-1",
  conversationId: CONVERSATION_ID,
  context: { conversationId: CONVERSATION_ID, messages: [] },
  lastInboundAt: new Date("2026-01-01T00:00:00Z"),
  lastOutboundAt: undefined,
  lastInboundMessageId: "message-1",
};

function interpretation(overrides: Partial<CommercialInterpretation> = {}): CommercialInterpretation {
  return {
    intent: "BOOKING",
    interestLevel: "HIGH",
    signals: ["BOOKING_INTENT"],
    entities: {},
    confidence: 0.9,
    ...overrides,
  };
}

describe("InterpretationService", () => {
  let service: InterpretationService;
  let contextBuilder: { build: jest.Mock };
  let interpreter: { interpret: jest.Mock };
  let opportunities: { evaluate: jest.Mock };

  beforeEach(async () => {
    contextBuilder = { build: jest.fn().mockResolvedValue(builtContext) };
    interpreter = { interpret: jest.fn().mockResolvedValue(interpretation()) };
    opportunities = { evaluate: jest.fn().mockResolvedValue({ opportunity: { id: "opportunity-1" }, evaluation: {} }) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        InterpretationService,
        { provide: ContextBuilderService, useValue: contextBuilder },
        { provide: COMMERCIAL_INTERPRETER, useValue: interpreter },
        { provide: OpportunitiesService, useValue: opportunities },
      ],
    }).compile();

    service = moduleRef.get(InterpretationService);
  });

  it("builds context, interprets it, maps the result, and calls OpportunitiesService.evaluate", async () => {
    await service.evaluate(CONVERSATION_ID);

    expect(contextBuilder.build).toHaveBeenCalledWith(CONVERSATION_ID);
    expect(interpreter.interpret).toHaveBeenCalledWith(builtContext.context);
    expect(opportunities.evaluate).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "company-1",
        customerId: "customer-1",
        conversationId: CONVERSATION_ID,
        interestLevel: "HIGH",
        signals: [{ type: "BOOKING_INTENT", confidence: 0.9, sourceMessageId: "message-1" }],
      }),
    );
  });

  it("passes NO_LONGER_INTERESTED through to OpportunitiesService.evaluate untouched", async () => {
    interpreter.interpret.mockResolvedValue(interpretation({ signals: ["NO_LONGER_INTERESTED"], interestLevel: "LOW" }));

    await service.evaluate(CONVERSATION_ID);

    expect(opportunities.evaluate).toHaveBeenCalledWith(
      expect.objectContaining({ signals: [expect.objectContaining({ type: "NO_LONGER_INTERESTED" })] }),
    );
  });

  it("passes OBJECTION through to OpportunitiesService.evaluate untouched", async () => {
    interpreter.interpret.mockResolvedValue(interpretation({ signals: ["OBJECTION"] }));

    await service.evaluate(CONVERSATION_ID);

    expect(opportunities.evaluate).toHaveBeenCalledWith(
      expect.objectContaining({ signals: [expect.objectContaining({ type: "OBJECTION" })] }),
    );
  });

  it("returns a null result without throwing when OpportunitiesService no-ops", async () => {
    opportunities.evaluate.mockResolvedValue(null);

    const outcome = await service.evaluate(CONVERSATION_ID);

    expect(outcome.result).toBeNull();
    expect(outcome.interpretation).toEqual(interpretation());
  });

  it("never calls OpportunitiesService.evaluate when interpretation fails, and propagates the error", async () => {
    interpreter.interpret.mockRejectedValue(new InterpretationError("PROVIDER_ERROR", "boom"));

    await expect(service.evaluate(CONVERSATION_ID)).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    expect(opportunities.evaluate).not.toHaveBeenCalled();
  });

  it("never calls OpportunitiesService.evaluate when the context builder fails, and propagates the error", async () => {
    contextBuilder.build.mockRejectedValue(new Error("conversation not found"));

    await expect(service.evaluate(CONVERSATION_ID)).rejects.toThrow("conversation not found");
    expect(interpreter.interpret).not.toHaveBeenCalled();
    expect(opportunities.evaluate).not.toHaveBeenCalled();
  });
});
