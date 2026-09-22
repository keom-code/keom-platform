import { OpportunityEngineService } from "./opportunity-engine.service";
import { EvaluateOpportunityInput, OpportunitySignalInput } from "./opportunities.types";

function signals(...types: OpportunitySignalInput["type"][]): OpportunitySignalInput[] {
  return types.map((type) => ({ type }));
}

describe("OpportunityEngineService", () => {
  let engine: OpportunityEngineService;

  beforeEach(() => {
    engine = new OpportunityEngineService();
  });

  it("computes a deterministic, explainable score and HIGH priority for strong commercial signals", () => {
    const input: EvaluateOpportunityInput = {
      interestLevel: "HIGH",
      signals: signals("PRICING_REQUESTED", "AVAILABILITY_REQUESTED", "BOOKING_INTENT"),
    };

    const result = engine.evaluate(input);

    // 15 + 25 + 30 + 20 (HIGH interest) = 90
    expect(result.score).toBe(90);
    expect(result.priority).toBe("HIGH");
    expect(result.scoreBreakdown).toEqual([
      { signal: "PRICING_REQUESTED", points: 15 },
      { signal: "AVAILABILITY_REQUESTED", points: 25 },
      { signal: "BOOKING_INTENT", points: 30 },
      { signal: "INTEREST_LEVEL", points: 20 },
    ]);
  });

  it("resolves HIGH_INTENT state when a strong signal is combined with HIGH priority", () => {
    const result = engine.evaluate({
      interestLevel: "HIGH",
      signals: signals("BOOKING_INTENT", "PURCHASE_INTENT"),
    });

    expect(result.priority).toBe("HIGH");
    expect(result.state).toBe("HIGH_INTENT");
    expect(result.stateReason).toBeTruthy();
  });

  it("resolves NEW state when there are no signals yet", () => {
    const result = engine.evaluate({ interestLevel: "LOW", signals: [] });
    expect(result.state).toBe("NEW");
  });

  it("evaluates HIGH risk and AT_RISK state for a high-interest opportunity stalled past the threshold", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    const lastInboundAt = new Date("2026-01-01T06:00:00Z"); // 6h ago, no outbound reply

    const result = engine.evaluate({
      interestLevel: "HIGH",
      signals: signals("BOOKING_INTENT"),
      lastInboundAt,
      now,
    });

    expect(result.risk).toBe("HIGH");
    expect(result.state).toBe("AT_RISK");
    expect(result.riskReason).toBeTruthy();
  });

  it("evaluates LOW risk when the business already responded after the last inbound message", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    const lastInboundAt = new Date("2026-01-01T06:00:00Z");
    const lastOutboundAt = new Date("2026-01-01T06:05:00Z");

    const result = engine.evaluate({
      interestLevel: "HIGH",
      signals: signals("BOOKING_INTENT"),
      lastInboundAt,
      lastOutboundAt,
      now,
    });

    expect(result.risk).toBe("LOW");
  });

  it("recommends OFFER_APPOINTMENT for BOOKING_INTENT + AVAILABILITY_REQUESTED", () => {
    const result = engine.evaluate({
      interestLevel: "MEDIUM",
      signals: signals("BOOKING_INTENT", "AVAILABILITY_REQUESTED"),
    });

    expect(result.nextBestAction).toBe("OFFER_APPOINTMENT");
    expect(result.actionReason).toBeTruthy();
  });

  it("recommends SEND_INFORMATION for PRICING_REQUESTED alone", () => {
    const result = engine.evaluate({ interestLevel: "LOW", signals: signals("PRICING_REQUESTED") });
    expect(result.nextBestAction).toBe("SEND_INFORMATION");
  });

  it("recommends ESCALATE_TO_HUMAN for an OBJECTION", () => {
    const result = engine.evaluate({ interestLevel: "MEDIUM", signals: signals("OBJECTION") });
    expect(result.nextBestAction).toBe("ESCALATE_TO_HUMAN");
  });

  it("applies the NO_LONGER_INTERESTED override: forces LOW priority/risk, WAIT action, and deactivation", () => {
    const result = engine.evaluate({
      interestLevel: "HIGH",
      signals: signals("BOOKING_INTENT", "AVAILABILITY_REQUESTED", "NO_LONGER_INTERESTED"),
    });

    expect(result.priority).toBe("LOW");
    expect(result.risk).toBe("LOW");
    expect(result.nextBestAction).toBe("WAIT");
    expect(result.deactivate).toBe(true);
    expect(result.actionReason).toMatch(/no longer interested/i);
  });

  it("does not set the deactivate flag when NO_LONGER_INTERESTED is absent", () => {
    const result = engine.evaluate({ interestLevel: "MEDIUM", signals: signals("PRICING_REQUESTED") });
    expect(result.deactivate).toBe(false);
  });
});
