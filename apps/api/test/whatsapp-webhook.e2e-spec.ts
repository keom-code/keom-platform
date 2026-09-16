import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Provider } from "@prisma/client";
import { receivedTextMessageWebhook } from "@keom/mocks";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

const TEST_COMPANY_ID = "00000000-0000-4000-8000-0000000000e2";
const TEST_INTEGRATION_ID = "00000000-0000-4000-8000-0000000000e3";
// Dedicated phoneNumberId, distinct from the seeded demo Integration's — this test
// creates and tears down its own Integration and must never touch seed data.
const TEST_PHONE_NUMBER_ID = "199999999999999";

function webhookForTestTenant() {
  return {
    ...receivedTextMessageWebhook,
    entry: receivedTextMessageWebhook.entry.map((entry) => ({
      ...entry,
      changes: entry.changes.map((change) => ({
        ...change,
        value: {
          ...change.value,
          metadata: { ...change.value.metadata, phone_number_id: TEST_PHONE_NUMBER_ID },
        },
      })),
    })),
  };
}

describe("WhatsApp webhook (e2e)", () => {
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
      create: { id: TEST_COMPANY_ID, name: "Clínica Demo (e2e)" },
    });
    await prisma.integration.upsert({
      where: { phoneNumberId: TEST_PHONE_NUMBER_ID },
      update: { companyId: TEST_COMPANY_ID, status: "ACTIVE" },
      create: {
        id: TEST_INTEGRATION_ID,
        companyId: TEST_COMPANY_ID,
        provider: Provider.WHATSAPP,
        phoneNumberId: TEST_PHONE_NUMBER_ID,
        status: "ACTIVE",
      },
    });
  });

  afterAll(async () => {
    await prisma.message.deleteMany({ where: { companyId: TEST_COMPANY_ID } });
    await prisma.conversation.deleteMany({ where: { companyId: TEST_COMPANY_ID } });
    await prisma.customer.deleteMany({ where: { companyId: TEST_COMPANY_ID } });
    await prisma.rawEvent.deleteMany({ where: { companyId: TEST_COMPANY_ID } });
    await prisma.integration.delete({ where: { phoneNumberId: TEST_PHONE_NUMBER_ID } });
    await prisma.company.delete({ where: { id: TEST_COMPANY_ID } });
    await app.close();
  });

  it("resolves the tenant, persists RawEvent/Customer/Conversation/Message on first delivery", async () => {
    await request(app.getHttpServer()).post("/webhooks/whatsapp").send(webhookForTestTenant()).expect(200);

    const messages = await prisma.message.findMany({ where: { companyId: TEST_COMPANY_ID } });
    expect(messages).toHaveLength(1);
    expect(messages[0]!.text).toContain("disponibilidad");

    const customers = await prisma.customer.findMany({ where: { companyId: TEST_COMPANY_ID } });
    expect(customers).toHaveLength(1);
    expect(customers[0]!.name).toBe("Andrea Torres");

    const conversations = await prisma.conversation.findMany({ where: { companyId: TEST_COMPANY_ID } });
    expect(conversations).toHaveLength(1);

    const rawEvents = await prisma.rawEvent.findMany({ where: { companyId: TEST_COMPANY_ID } });
    expect(rawEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("does not duplicate the Message on a repeated delivery of the same webhook (idempotency)", async () => {
    await request(app.getHttpServer()).post("/webhooks/whatsapp").send(webhookForTestTenant()).expect(200);

    const messages = await prisma.message.findMany({ where: { companyId: TEST_COMPANY_ID } });
    expect(messages).toHaveLength(1);
  });
});
