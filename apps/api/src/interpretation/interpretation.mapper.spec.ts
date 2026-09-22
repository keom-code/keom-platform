import { CommercialInterpretation } from "../llm/commercial-interpreter";
import { mapInterpretationToOpportunityInput } from "./interpretation.mapper";

function interpretation(overrides: Partial<CommercialInterpretation> = {}): CommercialInterpretation {
  return {
    intent: "BOOKING",
    interestLevel: "HIGH",
    signals: ["BOOKING_INTENT", "AVAILABILITY_REQUESTED"],
    entities: {},
    confidence: 0.9,
    ...overrides,
  };
}

describe("mapInterpretationToOpportunityInput", () => {
  it("maps interestLevel and signals straight through to the M2A input shape", () => {
    const result = mapInterpretationToOpportunityInput({
      companyId: "company-1",
      customerId: "customer-1",
      conversationId: "conversation-1",
      interpretation: interpretation(),
      lastInboundMessageId: "message-1",
      lastInboundAt: new Date("2026-01-01T00:00:00Z"),
      lastOutboundAt: undefined,
    });

    expect(result).toEqual({
      companyId: "company-1",
      customerId: "customer-1",
      conversationId: "conversation-1",
      interestLevel: "HIGH",
      signals: [
        { type: "BOOKING_INTENT", confidence: 0.9, sourceMessageId: "message-1" },
        { type: "AVAILABILITY_REQUESTED", confidence: 0.9, sourceMessageId: "message-1" },
      ],
      lastInboundAt: new Date("2026-01-01T00:00:00Z"),
      lastOutboundAt: undefined,
    });
  });

  it("passes NO_LONGER_INTERESTED through untouched, for M2A's override to handle", () => {
    const result = mapInterpretationToOpportunityInput({
      companyId: "company-1",
      customerId: "customer-1",
      conversationId: "conversation-1",
      interpretation: interpretation({ signals: ["NO_LONGER_INTERESTED"], interestLevel: "LOW" }),
    });

    expect(result.signals).toEqual([{ type: "NO_LONGER_INTERESTED", confidence: 0.9, sourceMessageId: undefined }]);
  });

  it("passes OBJECTION through untouched", () => {
    const result = mapInterpretationToOpportunityInput({
      companyId: "company-1",
      customerId: "customer-1",
      conversationId: "conversation-1",
      interpretation: interpretation({ signals: ["OBJECTION"] }),
    });

    expect(result.signals).toEqual([{ type: "OBJECTION", confidence: 0.9, sourceMessageId: undefined }]);
  });

  it("maps an empty signals array (OTHER intent) to an empty M2A signals array", () => {
    const result = mapInterpretationToOpportunityInput({
      companyId: "company-1",
      customerId: "customer-1",
      conversationId: "conversation-1",
      interpretation: interpretation({ intent: "OTHER", signals: [] }),
    });

    expect(result.signals).toEqual([]);
  });
});
