import { Test } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import { OpportunityEngineService } from "./opportunity-engine.service";
import { OpportunitiesService } from "./opportunities.service";

/**
 * OpportunitiesService.reevaluate() (M4 entry point) with Prisma mocked and the REAL
 * deterministic engine, so these tests prove M4 reuses M2A rather than re-implementing it.
 * DB-level behaviour (fresh rows, no writes when unchanged) is in test/reevaluation.e2e-spec.ts.
 */
const COMPANY_ID = "company-1";
const NOW = new Date("2026-01-01T12:00:00Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

function highIntent(overrides: Record<string, unknown> = {}) {
  return {
    id: "opp-1",
    companyId: COMPANY_ID,
    customerId: "customer-1",
    conversationId: "conversation-1",
    state: "HIGH_INTENT",
    priority: "HIGH",
    risk: "LOW",
    interestLevel: "HIGH",
    score: 75,
    isActive: true,
    currentSignals: ["BOOKING_INTENT", "AVAILABILITY_REQUESTED"],
    lastEvaluatedAt: minutesAgo(300),
    createdAt: minutesAgo(300),
    updatedAt: minutesAgo(300),
    ...overrides,
  };
}

describe("OpportunitiesService.reevaluate", () => {
  let service: OpportunitiesService;
  let prisma: {
    opportunity: { findFirst: jest.Mock; update: jest.Mock };
    message: { findFirst: jest.Mock };
    opportunitySignal: { createMany: jest.Mock };
    opportunityStateHistory: { create: jest.Mock };
    actionRecommendation: { findFirst: jest.Mock; create: jest.Mock };
  };

  function messages(lastInboundAt?: Date, lastOutboundAt?: Date) {
    prisma.message.findFirst.mockImplementation(({ where }: { where: { direction: string } }) => {
      const at = where.direction === "INBOUND" ? lastInboundAt : lastOutboundAt;
      return Promise.resolve(at ? { sentAt: at } : null);
    });
  }

  beforeEach(async () => {
    delete process.env.OPPORTUNITY_STALL_MEDIUM_MINUTES;
    delete process.env.OPPORTUNITY_STALL_HIGH_MINUTES;
    prisma = {
      opportunity: {
        findFirst: jest.fn().mockResolvedValue(highIntent()),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve(highIntent(data))),
      },
      message: { findFirst: jest.fn() },
      opportunitySignal: { createMany: jest.fn() },
      opportunityStateHistory: { create: jest.fn().mockResolvedValue({}) },
      actionRecommendation: { findFirst: jest.fn().mockResolvedValue({ action: "RESPOND" }), create: jest.fn().mockResolvedValue({}) },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [OpportunitiesService, OpportunityEngineService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(OpportunitiesService);
  });

  it("re-runs M2A on the persisted evidence with fresh timestamps and marks a stalled opportunity AT_RISK", async () => {
    messages(minutesAgo(250));
    const outcome = await service.reevaluate({ opportunityId: "opp-1", companyId: COMPANY_ID, now: NOW });

    expect(prisma.opportunity.findFirst).toHaveBeenCalledWith({ where: { id: "opp-1", companyId: COMPANY_ID } });
    expect(prisma.message.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { conversationId: "conversation-1", companyId: COMPANY_ID, direction: "INBOUND" } }),
    );
    expect(outcome.status).toBe("CHANGED");
    expect(prisma.opportunity.update).toHaveBeenCalledWith({
      where: { id: "opp-1" },
      data: expect.objectContaining({ state: "AT_RISK", risk: "HIGH", lastEvaluatedAt: NOW }),
    });
    expect(prisma.opportunityStateHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ previousState: "HIGH_INTENT", newState: "AT_RISK" }),
    });
    expect(prisma.opportunitySignal.createMany).not.toHaveBeenCalled();
  });

  it("does not escalate when the business replied after the customer (fresh state)", async () => {
    messages(minutesAgo(250), minutesAgo(200));
    prisma.actionRecommendation.findFirst.mockResolvedValue({ action: "OFFER_APPOINTMENT" });
    const outcome = await service.reevaluate({ opportunityId: "opp-1", companyId: COMPANY_ID, now: NOW });

    expect(outcome).toMatchObject({ status: "UNCHANGED", evaluation: { risk: "LOW", state: "HIGH_INTENT" } });
    expect(prisma.opportunity.update).not.toHaveBeenCalled();
    expect(prisma.opportunityStateHistory.create).not.toHaveBeenCalled();
    expect(prisma.actionRecommendation.create).not.toHaveBeenCalled();
  });

  it("respects the configured M2A thresholds", async () => {
    process.env.OPPORTUNITY_STALL_MEDIUM_MINUTES = "1";
    process.env.OPPORTUNITY_STALL_HIGH_MINUTES = "2";
    messages(minutesAgo(3));
    const outcome = await service.reevaluate({ opportunityId: "opp-1", companyId: COMPANY_ID, now: NOW });
    expect(outcome).toMatchObject({ status: "CHANGED", evaluation: { risk: "HIGH", riskReason: expect.stringContaining("2 min") } });
  });

  it("is a no-op for another company's opportunity, an inactive one, or one never evaluated", async () => {
    prisma.opportunity.findFirst.mockResolvedValueOnce(null);
    expect(await service.reevaluate({ opportunityId: "opp-1", companyId: "company-2", now: NOW })).toEqual({ status: "NOT_FOUND" });

    prisma.opportunity.findFirst.mockResolvedValueOnce(highIntent({ isActive: false }));
    expect((await service.reevaluate({ opportunityId: "opp-1", companyId: COMPANY_ID, now: NOW })).status).toBe("INACTIVE");

    prisma.opportunity.findFirst.mockResolvedValueOnce(highIntent({ interestLevel: null }));
    expect((await service.reevaluate({ opportunityId: "opp-1", companyId: COMPANY_ID, now: NOW })).status).toBe("NOT_EVALUATED");

    expect(prisma.message.findFirst).not.toHaveBeenCalled();
    expect(prisma.opportunity.update).not.toHaveBeenCalled();
  });
});
