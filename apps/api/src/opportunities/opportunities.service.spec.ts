import { Test } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import { OpportunityEngineService } from "./opportunity-engine.service";
import { OpportunitiesService } from "./opportunities.service";

const COMPANY_ID = "00000000-0000-4000-8000-000000000010";
const CUSTOMER_ID = "00000000-0000-4000-8000-000000000011";
const CONVERSATION_ID = "00000000-0000-4000-8000-000000000012";
const OPPORTUNITY_ID = "00000000-0000-4000-8000-000000000013";

function baseOpportunity(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: OPPORTUNITY_ID,
    companyId: COMPANY_ID,
    customerId: CUSTOMER_ID,
    conversationId: CONVERSATION_ID,
    state: "NEW",
    priority: "LOW",
    risk: "LOW",
    interestLevel: null,
    score: 0,
    isActive: true,
    lastEvaluatedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("OpportunitiesService", () => {
  let service: OpportunitiesService;
  let prisma: {
    opportunity: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
    opportunitySignal: { createMany: jest.Mock };
    opportunityStateHistory: { create: jest.Mock };
    actionRecommendation: { findFirst: jest.Mock; create: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      opportunity: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(baseOpportunity()),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve(baseOpportunity(data))),
      },
      opportunitySignal: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      opportunityStateHistory: { create: jest.fn().mockResolvedValue({ id: "history-1" }) },
      actionRecommendation: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "action-1" }),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OpportunitiesService,
        OpportunityEngineService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = moduleRef.get(OpportunitiesService);
  });

  it("creates a new Opportunity when no active one exists for the conversation", async () => {
    await service.evaluate({
      companyId: COMPANY_ID,
      customerId: CUSTOMER_ID,
      conversationId: CONVERSATION_ID,
      interestLevel: "HIGH",
      signals: [{ type: "PRICING_REQUESTED" }],
    });

    expect(prisma.opportunity.findFirst).toHaveBeenCalledWith({
      where: { conversationId: CONVERSATION_ID, isActive: true },
      orderBy: { updatedAt: "desc" },
    });
    expect(prisma.opportunity.create).toHaveBeenCalledWith({
      data: { companyId: COMPANY_ID, customerId: CUSTOMER_ID, conversationId: CONVERSATION_ID },
    });
  });

  it("reuses the existing active Opportunity instead of creating a new one", async () => {
    prisma.opportunity.findFirst.mockResolvedValue(baseOpportunity());

    await service.evaluate({
      companyId: COMPANY_ID,
      customerId: CUSTOMER_ID,
      conversationId: CONVERSATION_ID,
      interestLevel: "MEDIUM",
      signals: [{ type: "PRICING_REQUESTED" }],
    });

    expect(prisma.opportunity.create).not.toHaveBeenCalled();
  });

  it("persists a signal row per supplied signal", async () => {
    await service.evaluate({
      companyId: COMPANY_ID,
      customerId: CUSTOMER_ID,
      conversationId: CONVERSATION_ID,
      interestLevel: "HIGH",
      signals: [{ type: "PRICING_REQUESTED" }, { type: "BOOKING_INTENT", confidence: 0.9 }],
    });

    expect(prisma.opportunitySignal.createMany).toHaveBeenCalledWith({
      data: [
        { opportunityId: OPPORTUNITY_ID, type: "PRICING_REQUESTED", confidence: undefined, sourceMessageId: undefined },
        { opportunityId: OPPORTUNITY_ID, type: "BOOKING_INTENT", confidence: 0.9, sourceMessageId: undefined },
      ],
    });
  });

  it("records a state history row when the state changes", async () => {
    prisma.opportunity.findFirst.mockResolvedValue(baseOpportunity({ state: "NEW" }));

    await service.evaluate({
      companyId: COMPANY_ID,
      customerId: CUSTOMER_ID,
      conversationId: CONVERSATION_ID,
      interestLevel: "HIGH",
      signals: [{ type: "BOOKING_INTENT" }, { type: "PURCHASE_INTENT" }],
    });

    expect(prisma.opportunityStateHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        opportunityId: OPPORTUNITY_ID,
        previousState: "NEW",
        newState: "HIGH_INTENT",
      }),
    });
  });

  it("does not record state history when reevaluation produces the same state", async () => {
    prisma.opportunity.findFirst.mockResolvedValue(baseOpportunity({ state: "NEW" }));

    await service.evaluate({
      companyId: COMPANY_ID,
      customerId: CUSTOMER_ID,
      conversationId: CONVERSATION_ID,
      interestLevel: "LOW",
      signals: [],
    });

    expect(prisma.opportunityStateHistory.create).not.toHaveBeenCalled();
  });

  it("creates a new ActionRecommendation only when the recommended action changes", async () => {
    prisma.actionRecommendation.findFirst.mockResolvedValue({ id: "prev", action: "SEND_INFORMATION" });

    await service.evaluate({
      companyId: COMPANY_ID,
      customerId: CUSTOMER_ID,
      conversationId: CONVERSATION_ID,
      interestLevel: "LOW",
      signals: [{ type: "PRICING_REQUESTED" }],
    });

    expect(prisma.actionRecommendation.create).not.toHaveBeenCalled();
  });

  it("returns null and creates nothing when there is no active Opportunity and no signals are supplied", async () => {
    const result = await service.evaluate({
      companyId: COMPANY_ID,
      customerId: CUSTOMER_ID,
      conversationId: CONVERSATION_ID,
      interestLevel: "LOW",
      signals: [],
    });

    expect(result).toBeNull();
    expect(prisma.opportunity.create).not.toHaveBeenCalled();
    expect(prisma.opportunity.update).not.toHaveBeenCalled();
    expect(prisma.opportunitySignal.createMany).not.toHaveBeenCalled();
  });

  it("still reevaluates an existing active Opportunity even with zero signals", async () => {
    prisma.opportunity.findFirst.mockResolvedValue(baseOpportunity({ state: "NEW" }));

    const result = await service.evaluate({
      companyId: COMPANY_ID,
      customerId: CUSTOMER_ID,
      conversationId: CONVERSATION_ID,
      interestLevel: "LOW",
      signals: [],
    });

    expect(result).not.toBeNull();
    expect(prisma.opportunity.create).not.toHaveBeenCalled();
    expect(prisma.opportunity.update).toHaveBeenCalled();
  });

  it("deactivates the Opportunity when NO_LONGER_INTERESTED is present", async () => {
    prisma.opportunity.findFirst.mockResolvedValue(baseOpportunity({ isActive: true }));

    await service.evaluate({
      companyId: COMPANY_ID,
      customerId: CUSTOMER_ID,
      conversationId: CONVERSATION_ID,
      interestLevel: "HIGH",
      signals: [{ type: "BOOKING_INTENT" }, { type: "NO_LONGER_INTERESTED" }],
    });

    expect(prisma.opportunity.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isActive: false, priority: "LOW" }) }),
    );
  });
});
