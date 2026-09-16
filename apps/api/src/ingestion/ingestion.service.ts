import { Injectable, Logger } from "@nestjs/common";
import { Company, Prisma, Provider } from "@prisma/client";
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
