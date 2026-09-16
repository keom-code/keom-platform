import { Test } from "@nestjs/testing";
import { Prisma, Provider } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { IngestionService } from "./ingestion.service";
import { NormalizedMessage, NormalizedWebhookEvent } from "./types";

function uniqueConstraintError() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
  });
}

describe("IngestionService", () => {
  let service: IngestionService;
  let prisma: {
    rawEvent: { create: jest.Mock };
    integration: { findUnique: jest.Mock };
    customer: { upsert: jest.Mock };
    conversation: { upsert: jest.Mock };
    message: { create: jest.Mock };
  };

  const COMPANY_ID = "company-1";
  const PHONE_NUMBER_ID = "phone-1";

  const message: NormalizedMessage = {
    provider: "WHATSAPP",
    phoneNumberId: PHONE_NUMBER_ID,
    externalMessageId: "wamid.1",
    externalCustomerId: "51900000000",
    customerName: "Andrea Torres",
    messageType: "TEXT",
    text: "Hola",
    occurredAt: new Date("2026-01-01T00:00:00Z"),
  };

  const event: NormalizedWebhookEvent = {
    provider: "WHATSAPP",
    rawPayload: { object: "whatsapp_business_account" },
    entries: [{ phoneNumberId: PHONE_NUMBER_ID, messages: [message] }],
  };

  beforeEach(async () => {
    prisma = {
      rawEvent: { create: jest.fn().mockResolvedValue({ id: "raw-1" }) },
      integration: {
        findUnique: jest.fn().mockResolvedValue({ company: { id: COMPANY_ID } }),
      },
      customer: { upsert: jest.fn().mockResolvedValue({ id: "customer-1" }) },
      conversation: { upsert: jest.fn().mockResolvedValue({ id: "conversation-1" }) },
      message: { create: jest.fn().mockResolvedValue({ id: "message-1" }) },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [IngestionService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(IngestionService);
  });

  it("resolves the company via the Integration's phoneNumberId and persists RawEvent, Customer, Conversation, Message", async () => {
    await service.ingestEvent(event);

    expect(prisma.integration.findUnique).toHaveBeenCalledWith({
      where: { phoneNumberId: PHONE_NUMBER_ID },
      include: { company: true },
    });

    expect(prisma.rawEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ companyId: COMPANY_ID }) }),
    );

    expect(prisma.customer.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId_externalId: { companyId: COMPANY_ID, externalId: message.externalCustomerId } },
      }),
    );

    expect(prisma.conversation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId_customerId_channel: {
            companyId: COMPANY_ID,
            customerId: "customer-1",
            channel: Provider.WHATSAPP,
          },
        },
      }),
    );

    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: COMPANY_ID,
          conversationId: "conversation-1",
          externalMessageId: message.externalMessageId,
          direction: "INBOUND",
        }),
      }),
    );
  });

  it("skips domain persistence but still records RawEvent when the phoneNumberId is unknown", async () => {
    prisma.integration.findUnique.mockResolvedValue(null);

    await service.ingestEvent(event);

    expect(prisma.rawEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ companyId: null }) }),
    );
    expect(prisma.customer.upsert).not.toHaveBeenCalled();
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it("does not throw when Message creation hits the idempotency unique constraint", async () => {
    prisma.message.create.mockRejectedValue(uniqueConstraintError());

    await expect(service.ingestEvent(event)).resolves.toBeUndefined();
  });
});
