import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Post, Query } from "@nestjs/common";
import { ZodError } from "zod";
import { IngestionService } from "../ingestion/ingestion.service";
import { normalizeWhatsAppWebhook } from "./whatsapp.normalizer";
import { WhatsAppWebhookPayloadSchema } from "./whatsapp-webhook.schema";

@Controller("webhooks/whatsapp")
export class WhatsappController {
  constructor(private readonly ingestion: IngestionService) {}

  /**
   * Meta's webhook subscription verification handshake. Not exercised by the M1
   * fixture-POST testing flow; only relevant once this URL is actually registered
   * as a callback with Meta (a future/production concern).
   */
  @Get()
  verify(@Query() query: Record<string, string>) {
    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
    if (query["hub.mode"] === "subscribe" && query["hub.verify_token"] === verifyToken) {
      return query["hub.challenge"];
    }
    throw new ForbiddenException("Invalid webhook verification request");
  }

  @Post()
  @HttpCode(200)
  async receive(@Body() body: unknown) {
    let payload;
    try {
      payload = WhatsAppWebhookPayloadSchema.parse(body);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException("Invalid WhatsApp webhook payload");
      }
      throw err;
    }

    const entries = normalizeWhatsAppWebhook(payload);
    await this.ingestion.ingestEvent({ provider: "WHATSAPP", entries, rawPayload: body });

    return { status: "ok" };
  }
}
