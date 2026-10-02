import { BadRequestException, Body, Controller, Param, Post } from "@nestjs/common";
import { z, ZodError } from "zod";
import { IngestionService } from "./ingestion.service";

const BusinessReplyRequestSchema = z.object({
  companyId: z.string().uuid(),
  text: z.string().max(4096).optional(),
  sentAt: z.string().datetime({ offset: true }).optional(),
});

/**
 * Dev-only (M4): simulate "the business replied" so time-based re-evaluation can see it
 * (see IngestionService.recordBusinessReply). No auth, same conventions as the other
 * /dev endpoints. Records a message; sends nothing.
 */
@Controller("dev/conversations")
export class DevBusinessReplyController {
  constructor(private readonly ingestion: IngestionService) {}

  @Post(":conversationId/business-replies")
  async recordBusinessReply(@Param("conversationId") conversationId: string, @Body() body: unknown) {
    let payload;
    try {
      payload = BusinessReplyRequestSchema.parse(body);
      z.string().uuid().parse(conversationId);
    } catch (err) {
      if (err instanceof ZodError) throw new BadRequestException("Invalid business reply request");
      throw err;
    }
    const message = await this.ingestion.recordBusinessReply({
      companyId: payload.companyId,
      conversationId,
      text: payload.text,
      sentAt: payload.sentAt ? new Date(payload.sentAt) : undefined,
    });
    return { messageId: message.id, conversationId, direction: message.direction, sentAt: message.sentAt };
  }
}
