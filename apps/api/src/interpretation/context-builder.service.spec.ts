import { NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import { ContextBuilderService } from "./context-builder.service";

const CONVERSATION_ID = "conversation-1";
const COMPANY_ID = "company-1";
const CUSTOMER_ID = "customer-1";

function message(overrides: Partial<Record<string, unknown>>) {
  return {
    id: "message-x",
    companyId: COMPANY_ID,
    conversationId: CONVERSATION_ID,
    externalMessageId: "wamid.x",
    direction: "INBOUND",
    type: "TEXT",
    text: "hola",
    sentAt: new Date("2026-01-01T00:00:00Z"),
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("ContextBuilderService", () => {
  let service: ContextBuilderService;
  let prisma: { conversation: { findUnique: jest.Mock }; message: { findMany: jest.Mock } };

  beforeEach(async () => {
    prisma = {
      conversation: {
        findUnique: jest.fn().mockResolvedValue({ id: CONVERSATION_ID, companyId: COMPANY_ID, customerId: CUSTOMER_ID }),
      },
      message: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [ContextBuilderService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(ContextBuilderService);
  });

  it("throws NotFoundException when the conversation does not exist", async () => {
    prisma.conversation.findUnique.mockResolvedValue(null);
    await expect(service.build(CONVERSATION_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("requests at most the 10 most recent messages, ordered by sentAt desc", async () => {
    await service.build(CONVERSATION_ID);

    expect(prisma.message.findMany).toHaveBeenCalledWith({
      where: { conversationId: CONVERSATION_ID },
      orderBy: { sentAt: "desc" },
      take: 10,
    });
  });

  it("returns messages in chronological (oldest-first) order for the prompt", async () => {
    prisma.message.findMany.mockResolvedValue([
      message({ id: "m2", text: "second", sentAt: new Date("2026-01-01T00:02:00Z") }),
      message({ id: "m1", text: "first", sentAt: new Date("2026-01-01T00:01:00Z") }),
    ]);

    const result = await service.build(CONVERSATION_ID);

    expect(result.context.messages.map((m) => m.text)).toEqual(["first", "second"]);
  });

  it("derives lastInboundAt/lastOutboundAt/lastInboundMessageId from the fetched messages", async () => {
    prisma.message.findMany.mockResolvedValue([
      message({ direction: "OUTBOUND", sentAt: new Date("2026-01-01T00:03:00Z") }),
      message({ id: "m-latest-inbound", direction: "INBOUND", sentAt: new Date("2026-01-01T00:02:00Z") }),
      message({ direction: "INBOUND", sentAt: new Date("2026-01-01T00:01:00Z") }),
    ]);

    const result = await service.build(CONVERSATION_ID);

    expect(result.lastInboundAt).toEqual(new Date("2026-01-01T00:02:00Z"));
    expect(result.lastOutboundAt).toEqual(new Date("2026-01-01T00:03:00Z"));
    expect(result.lastInboundMessageId).toBe("m-latest-inbound");
  });

  it("leaves lastOutboundAt undefined when there is no outbound message yet", async () => {
    prisma.message.findMany.mockResolvedValue([message({ direction: "INBOUND" })]);

    const result = await service.build(CONVERSATION_ID);

    expect(result.lastOutboundAt).toBeUndefined();
  });
});
