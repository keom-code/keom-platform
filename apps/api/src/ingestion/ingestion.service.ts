import { Injectable, Logger } from "@nestjs/common";
import { Prisma, Provider } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { NormalizedMessage, NormalizedWebhookEvent } from "./types";

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async ingestEvent(event: NormalizedWebhookEvent): Promise<void> {
    const primaryPhoneNumberId = event.entries[0]?.phoneNumberId;
    const primaryCompanyId = primaryPhoneNumberId
      ? (await this.resolveCompanyByPhoneNumberId(primaryPhoneNumberId))?.id
      : undefined;

    await this.prisma.rawEvent.create({
      data: {
        companyId: primaryCompanyId ?? null,
        provider: event.provider as Provider,
        eventType: "messages",
        payload: event.rawPayload as Prisma.InputJsonValue,
        receivedAt: new Date(),
      },
    });

    for (const entry of event.entries) {
      const company = await this.resolveCompanyByPhoneNumberId(entry.phoneNumberId);
      if (!company) {
        this.logger.warn(`No Integration found for phoneNumberId=${entry.phoneNumberId}; skipping ${entry.messages.length} message(s)`);
        continue;
      }

      for (const message of entry.messages) {
        await this.persistMessage(company.id, message);
      }
    }
  }

  private async resolveCompanyByPhoneNumberId(phoneNumberId: string) {
    const integration = await this.prisma.integration.findUnique({
      where: { phoneNumberId },
      include: { company: true },
    });
    return integration?.company ?? null;
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
