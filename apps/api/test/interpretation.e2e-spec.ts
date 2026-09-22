import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Provider } from "@prisma/client";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";
import { COMMERCIAL_INTERPRETER, CommercialInterpretation, InterpretationError } from "../src/llm/commercial-interpreter";

const TEST_COMPANY_ID = "00000000-0000-4000-8000-0000000000a0";
const TEST_CUSTOMER_ID = "00000000-0000-4000-8000-0000000000a1";
const TEST_CONVERSATION_ID = "00000000-0000-4000-8000-0000000000a2";
const TEST_MESSAGE_ID = "00000000-0000-4000-8000-0000000000a3";

/**
 * No real LLM call in automated tests (per M2B sign-off): CommercialInterpreter is
 * DI-overridden with this mock for the whole suite. Real-provider testing is the
 * manual/documented path in apps/api/README.md, not this file.
 */
const mockInterpreter = { interpret: jest.fn<Promise<CommercialInterpretation>, [unknown]>() };

describe("Interpretation evaluation (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(COMMERCIAL_INTERPRETER)
      .useValue(mockInterpreter)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.company.upsert({
      where: { id: TEST_COMPANY_ID },
      update: {},
      create: { id: TEST_COMPANY_ID, name: "Clínica Demo (interpretation e2e)" },
    });
    await prisma.customer.upsert({
      where: { id: TEST_CUSTOMER_ID },
      update: {},
      create: { id: TEST_CUSTOMER_ID, companyId: TEST_COMPANY_ID, externalId: "51900000002", name: "Andrea Torres" },
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
    await prisma.message.upsert({
      where: { companyId_externalMessageId: { companyId: TEST_COMPANY_ID, externalMessageId: "wamid.interp-e2e-1" } },
      update: {},
      create: {
        id: TEST_MESSAGE_ID,
        companyId: TEST_COMPANY_ID,
        conversationId: TEST_CONVERSATION_ID,
        externalMessageId: "wamid.interp-e2e-1",
        direction: "INBOUND",
        type: "TEXT",
        text: "Hola, quiero reservar una cita para el sábado, ¿tienen disponibilidad?",
        // Recent on purpose: M2A's risk rule is real time-based (no outbound reply +
        // elapsed > threshold => HIGH risk => AT_RISK overrides HIGH_INTENT), so an old
        // fixture timestamp here would make this "fresh interaction" scenario look
        // stalled. See opportunity-engine.service.ts's risk rule.
        sentAt: new Date(),
      },
    });
  });

  beforeEach(() => {
    mockInterpreter.interpret.mockReset();
  });

  afterAll(async () => {
    await prisma.actionRecommendation.deleteMany({ where: { opportunity: { conversationId: TEST_CONVERSATION_ID } } });
    await prisma.opportunityStateHistory.deleteMany({ where: { opportunity: { conversationId: TEST_CONVERSATION_ID } } });
    await prisma.opportunitySignal.deleteMany({ where: { opportunity: { conversationId: TEST_CONVERSATION_ID } } });
    await prisma.opportunity.deleteMany({ where: { conversationId: TEST_CONVERSATION_ID } });
    await prisma.message.deleteMany({ where: { conversationId: TEST_CONVERSATION_ID } });
    await prisma.conversation.delete({ where: { id: TEST_CONVERSATION_ID } });
    await prisma.customer.delete({ where: { id: TEST_CUSTOMER_ID } });
    await prisma.company.delete({ where: { id: TEST_COMPANY_ID } });
    await app.close();
  });

  it("interprets the conversation, maps into M2A, and persists a HIGH_INTENT Opportunity", async () => {
    mockInterpreter.interpret.mockResolvedValue({
      intent: "BOOKING",
      interestLevel: "HIGH",
      signals: ["BOOKING_INTENT", "AVAILABILITY_REQUESTED"],
      entities: { requestedDate: "sábado" },
      confidence: 0.87,
    });

    const response = await request(app.getHttpServer())
      .post("/dev/interpretation/evaluate")
      .send({ conversationId: TEST_CONVERSATION_ID })
      .expect(201);

    expect(mockInterpreter.interpret).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: TEST_CONVERSATION_ID,
        messages: [expect.objectContaining({ direction: "INBOUND" })],
      }),
    );
    expect(response.body.interpretation.intent).toBe("BOOKING");
    expect(response.body.opportunity.state).toBe("HIGH_INTENT");
    expect(response.body.opportunity.nextBestAction).toBe("OFFER_APPOINTMENT");

    const signals = await prisma.opportunitySignal.findMany({
      where: { opportunity: { conversationId: TEST_CONVERSATION_ID } },
    });
    expect(signals).toHaveLength(2);
    expect(signals[0]!.confidence).toBeCloseTo(0.87);
    expect(signals[0]!.sourceMessageId).toBe(TEST_MESSAGE_ID);
  });

  it("deactivates the Opportunity when the interpretation yields NO_LONGER_INTERESTED", async () => {
    mockInterpreter.interpret.mockResolvedValue({
      intent: "OTHER",
      interestLevel: "LOW",
      signals: ["NO_LONGER_INTERESTED"],
      entities: {},
      confidence: 0.7,
    });

    const response = await request(app.getHttpServer())
      .post("/dev/interpretation/evaluate")
      .send({ conversationId: TEST_CONVERSATION_ID })
      .expect(201);

    expect(response.body.opportunity.isActive).toBe(false);
    expect(response.body.opportunity.nextBestAction).toBe("WAIT");
  });

  it("does not create an Opportunity when there is no active one and the interpretation finds no signals", async () => {
    mockInterpreter.interpret.mockResolvedValue({
      intent: "OTHER",
      interestLevel: "LOW",
      signals: [],
      entities: {},
      confidence: 0.4,
    });

    const before = await prisma.opportunity.count({ where: { conversationId: TEST_CONVERSATION_ID } });

    const response = await request(app.getHttpServer())
      .post("/dev/interpretation/evaluate")
      .send({ conversationId: TEST_CONVERSATION_ID })
      .expect(201);

    expect(response.body.opportunity.noOp).toBe(true);

    const after = await prisma.opportunity.count({ where: { conversationId: TEST_CONVERSATION_ID } });
    expect(after).toBe(before);
  });

  it("fails safely (no Opportunity mutation) when the interpreter throws", async () => {
    mockInterpreter.interpret.mockRejectedValue(new InterpretationError("PROVIDER_ERROR", "simulated provider failure"));

    const before = await prisma.opportunity.findMany({ where: { conversationId: TEST_CONVERSATION_ID } });

    await request(app.getHttpServer())
      .post("/dev/interpretation/evaluate")
      .send({ conversationId: TEST_CONVERSATION_ID })
      .expect(502);

    const after = await prisma.opportunity.findMany({ where: { conversationId: TEST_CONVERSATION_ID } });
    expect(after).toEqual(before);
  });

  it("returns 404 for a conversation that does not exist", async () => {
    await request(app.getHttpServer())
      .post("/dev/interpretation/evaluate")
      .send({ conversationId: "00000000-0000-4000-8000-0000000000ff" })
      .expect(404);
  });
});
