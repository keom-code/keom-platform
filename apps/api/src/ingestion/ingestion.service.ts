import { randomUUID } from "node:crypto";
import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Company, Message, Prisma, Provider } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { NormalizedEntry, NormalizedMessage, NormalizedWebhookEvent } from "./types";

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

interface DeliverableMessage {
  companyId: string;
  message: NormalizedMessage;
}

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async ingestEvent(event: NormalizedWebhookEvent): Promise<void> {
    const companyByPhoneNumberId = await this.resolveCompaniesByPhoneNumberId(event.entries);
    const primaryCompanyId = companyByPhoneNumberId.get(event.entries[0]?.phoneNumberId ?? "")?.id;

    await this.prisma.rawEvent.create({
      data: {
        companyId: primaryCompanyId ?? null,
        provider: event.provider as Provider,
        eventType: "messages",
        payload: event.rawPayload as Prisma.InputJsonValue,
        receivedAt: new Date(),
      },
    });

    const deliverableMessages = this.toDeliverableMessages(event.entries, companyByPhoneNumberId);
    for (const { companyId, message } of deliverableMessages) {
      await this.persistMessage(companyId, message);
    }
  }

  /**
   * Dev-only (M4): records that the business replied in a conversation, as an OUTBOUND
   * Message. KEOM does not capture real seller replies yet (Meta delivers business-sent
   * messages as statuses/echoes, not ingested in M1), so without this the "business
   * replied" case can't be exercised. Sends nothing to WhatsApp. Company-scoped: a
   * conversation of another company answers 404.
   */
  async recordBusinessReply(params: { companyId: string; conversationId: string; text?: string; sentAt?: Date }): Promise<Message> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: params.conversationId, companyId: params.companyId },
      select: { id: true },
    });
    if (!conversation) {
      throw new NotFoundException(`Conversation ${params.conversationId} not found for this company`);
    }
    const message = await this.prisma.message.create({
      data: {
        companyId: params.companyId,
        conversationId: conversation.id,
        externalMessageId: `dev-business-reply-${randomUUID()}`,
        direction: "OUTBOUND",
        type: "TEXT",
        text: params.text ?? null,
        sentAt: params.sentAt ?? new Date(),
      },
    });
    this.logger.log(`Recorded dev business reply messageId=${message.id} conversationId=${conversation.id} companyId=${params.companyId}`);
    return message;
  }

  /** One query for every phoneNumberId in the payload instead of one per entry. */
  private async resolveCompaniesByPhoneNumberId(entries: NormalizedEntry[]): Promise<Map<string, Company>> {
    const phoneNumberIds = [...new Set(entries.map((entry) => entry.phoneNumberId))];
    const integrations = await this.prisma.integration.findMany({
      where: { phoneNumberId: { in: phoneNumberIds } },
      include: { company: true },
    });
    return new Map(integrations.map((integration) => [integration.phoneNumberId, integration.company]));
  }

  private toDeliverableMessages(
    entries: NormalizedEntry[],
    companyByPhoneNumberId: Map<string, Company>,
  ): DeliverableMessage[] {
    return entries.flatMap((entry) => {
      const company = companyByPhoneNumberId.get(entry.phoneNumberId);
      if (!company) {
        this.logger.warn(`No Integration found for phoneNumberId=${entry.phoneNumberId}; skipping ${entry.messages.length} message(s)`);
        return [];
      }
      return entry.messages.map((message) => ({ companyId: company.id, message }));
    });
  }

  private async persistMessage(companyId: string, message: NormalizedMessage): Promise<void> {
    const customer = await this.prisma.customer.upsert({
      where: { companyId_externalId: { companyId, externalId: message.externalCustomerId } },
      update: message.customerName ? { name: message.customerName } : {},
      create: {
        companyId,
        externalId: message.externalCustomerId,
        name: message.customerName,
        phone: message.externalCustomerId,
      },
    });

    const conversation = await this.prisma.conversation.upsert({
      where: {
        companyId_customerId_channel: {
          companyId,
          customerId: customer.id,
          channel: Provider.WHATSAPP,
        },
      },
      update: {},
      create: {
        companyId,
        customerId: customer.id,
        channel: Provider.WHATSAPP,
      },
    });

    try {
      await this.prisma.message.create({
        data: {
          companyId,
          conversationId: conversation.id,
          externalMessageId: message.externalMessageId,
          direction: "INBOUND",
          type: message.messageType,
          text: message.text,
          sentAt: message.occurredAt,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_CONSTRAINT_VIOLATION) {
        this.logger.log(`Duplicate delivery ignored for externalMessageId=${message.externalMessageId}`);
        return;
      }
      throw err;
    }
  }
}
