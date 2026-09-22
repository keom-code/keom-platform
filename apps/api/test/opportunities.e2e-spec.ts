import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Provider } from "@prisma/client";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

const TEST_COMPANY_ID = "00000000-0000-4000-8000-0000000000f0";
const TEST_CUSTOMER_ID = "00000000-0000-4000-8000-0000000000f1";
const TEST_CONVERSATION_ID = "00000000-0000-4000-8000-0000000000f2";

describe("Opportunity evaluation (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.company.upsert({
      where: { id: TEST_COMPANY_ID },
      update: {},
      create: { id: TEST_COMPANY_ID, name: "Clínica Demo (opportunities e2e)" },
    });
    await prisma.customer.upsert({
      where: { id: TEST_CUSTOMER_ID },
      update: {},
      create: { id: TEST_CUSTOMER_ID, companyId: TEST_COMPANY_ID, externalId: "51900000001", name: "Andrea Torres" },
    });
    await prisma.conversation.upsert({
      where: { id: TEST_CONVERSATION_ID },
      update: {},
      create: {
        id: TEST_CONVERSATION_ID,
        companyId: TEST_COMPANY_ID,
        customerId: TEST_CUSTOMER_ID,
        channel: Provider.WHATSAPP,
      },
    });
  });

  afterAll(async () => {
    await prisma.actionRecommendation.deleteMany({ where: { opportunity: { conversationId: TEST_CONVERSATION_ID } } });
    await prisma.opportunityStateHistory.deleteMany({ where: { opportunity: { conversationId: TEST_CONVERSATION_ID } } });
    await prisma.opportunitySignal.deleteMany({ where: { opportunity: { conversationId: TEST_CONVERSATION_ID } } });
    await prisma.opportunity.deleteMany({ where: { conversationId: TEST_CONVERSATION_ID } });
    await prisma.conversation.delete({ where: { id: TEST_CONVERSATION_ID } });
    await prisma.customer.delete({ where: { id: TEST_CUSTOMER_ID } });
    await prisma.company.delete({ where: { id: TEST_COMPANY_ID } });
    await app.close();
  });

  it("creates an Opportunity, computes HIGH_INTENT/HIGH priority, and recommends OFFER_APPOINTMENT", async () => {
    const response = await request(app.getHttpServer())
      .post("/dev/opportunities/evaluate")
      .send({
        companyId: TEST_COMPANY_ID,
        customerId: TEST_CUSTOMER_ID,
        conversationId: TEST_CONVERSATION_ID,
        interestLevel: "HIGH",
        signals: [{ type: "BOOKING_INTENT" }, { type: "AVAILABILITY_REQUESTED" }],
      })
      .expect(201);

    expect(response.body.state).toBe("HIGH_INTENT");
    expect(response.body.priority).toBe("HIGH");
    expect(response.body.nextBestAction).toBe("OFFER_APPOINTMENT");
    expect(response.body.isActive).toBe(true);

    const opportunities = await prisma.opportunity.findMany({ where: { conversationId: TEST_CONVERSATION_ID } });
    expect(opportunities).toHaveLength(1);

    const signals = await prisma.opportunitySignal.findMany({ where: { opportunityId: opportunities[0]!.id } });
    expect(signals).toHaveLength(2);

    const history = await prisma.opportunityStateHistory.findMany({ where: { opportunityId: opportunities[0]!.id } });
    expect(history).toHaveLength(1);
    expect(history[0]!.newState).toBe("HIGH_INTENT");
  });

  it("reuses the same active Opportunity on a second evaluation of the same conversation", async () => {
    await request(app.getHttpServer())
      .post("/dev/opportunities/evaluate")
      .send({
        companyId: TEST_COMPANY_ID,
        customerId: TEST_CUSTOMER_ID,
        conversationId: TEST_CONVERSATION_ID,
        interestLevel: "HIGH",
        signals: [{ type: "PRICING_REQUESTED" }],
      })
      .expect(201);

    const opportunities = await prisma.opportunity.findMany({ where: { conversationId: TEST_CONVERSATION_ID } });
    expect(opportunities).toHaveLength(1);
  });

  it("deactivates the Opportunity and forces a WAIT recommendation on NO_LONGER_INTERESTED", async () => {
    const response = await request(app.getHttpServer())
      .post("/dev/opportunities/evaluate")
      .send({
        companyId: TEST_COMPANY_ID,
        customerId: TEST_CUSTOMER_ID,
        conversationId: TEST_CONVERSATION_ID,
        interestLevel: "HIGH",
        signals: [{ type: "NO_LONGER_INTERESTED" }],
      })
      .expect(201);

    expect(response.body.priority).toBe("LOW");
    expect(response.body.nextBestAction).toBe("WAIT");
    expect(response.body.isActive).toBe(false);

    const opportunities = await prisma.opportunity.findMany({ where: { conversationId: TEST_CONVERSATION_ID } });
    expect(opportunities).toHaveLength(1);
    expect(opportunities[0]!.isActive).toBe(false);
  });

  it("creates a new Opportunity for the same conversation once the previous one is deactivated", async () => {
    await request(app.getHttpServer())
      .post("/dev/opportunities/evaluate")
      .send({
        companyId: TEST_COMPANY_ID,
        customerId: TEST_CUSTOMER_ID,
        conversationId: TEST_CONVERSATION_ID,
        interestLevel: "MEDIUM",
        signals: [{ type: "PRICING_REQUESTED" }],
      })
      .expect(201);

    const opportunities = await prisma.opportunity.findMany({ where: { conversationId: TEST_CONVERSATION_ID } });
    expect(opportunities).toHaveLength(2);
    expect(opportunities.filter((o) => o.isActive)).toHaveLength(1);
  });
});
