import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CommercialContext } from "../llm/commercial-interpreter";

/**
 * Bounded, deterministic context for the LLM (M2B cost-awareness, see
 * apps/api/README.md): last MAX_MESSAGES messages only, ordered oldest-first, no full
 * conversation history, no prior signals/Opportunity state fed into the prompt (that
 * would anchor the LLM on stale state — M2A alone owns state transitions).
 */
const MAX_MESSAGES = 10;

export interface ConversationContext {
  companyId: string;
  customerId: string;
  conversationId: string;
  context: CommercialContext;
  lastInboundAt?: Date;
  lastOutboundAt?: Date;
  lastInboundMessageId?: string;
}

@Injectable()
export class ContextBuilderService {
  constructor(private readonly prisma: PrismaService) {}

  async build(conversationId: string): Promise<ConversationContext> {
    const conversation = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation) {
      throw new NotFoundException(`Conversation ${conversationId} not found`);
    }

    const recentMessages = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { sentAt: "desc" },
      take: MAX_MESSAGES,
    });
    const chronological = [...recentMessages].reverse();

    const lastInbound = this.latestMessage(chronological, "INBOUND");
    const lastOutbound = this.latestMessage(chronological, "OUTBOUND");

    return {
      companyId: conversation.companyId,
      customerId: conversation.customerId,
      conversationId: conversation.id,
      context: {
        conversationId: conversation.id,
        messages: chronological.map((message) => ({
          direction: message.direction,
          text: message.text ?? "",
          sentAt: message.sentAt,
        })),
      },
      lastInboundAt: lastInbound?.sentAt,
      lastOutboundAt: lastOutbound?.sentAt,
      lastInboundMessageId: lastInbound?.id,
    };
  }

  private latestMessage<T extends { direction: string; sentAt: Date }>(messages: T[], direction: "INBOUND" | "OUTBOUND"): T | undefined {
    const matches = messages.filter((message) => message.direction === direction);
    if (matches.length === 0) return undefined;
    return matches.reduce((latest, message) => (message.sentAt > latest.sentAt ? message : latest));
  }
}
