import { z } from "zod";

/**
 * Shape validation only — loose/passthrough on purpose. Meta's webhook carries message
 * types and event fields (statuses, reactions, media, etc.) this milestone doesn't
 * process; those must not fail validation, just be ignored by the normalizer.
 */

export const WhatsAppContactSchema = z
  .object({
    profile: z.object({ name: z.string().optional() }).optional(),
    wa_id: z.string(),
  })
  .passthrough();

export const WhatsAppMessageSchema = z
  .object({
    from: z.string(),
    id: z.string(),
    timestamp: z.string(),
    type: z.string(),
    text: z.object({ body: z.string() }).optional(),
  })
  .passthrough();

export const WhatsAppValueSchema = z
  .object({
    messaging_product: z.literal("whatsapp"),
    metadata: z
      .object({
        display_phone_number: z.string().optional(),
        phone_number_id: z.string(),
      })
      .passthrough(),
    contacts: z.array(WhatsAppContactSchema).optional(),
    messages: z.array(WhatsAppMessageSchema).optional(),
  })
  .passthrough();

export const WhatsAppChangeSchema = z
  .object({
    value: WhatsAppValueSchema,
    field: z.string(),
  })
  .passthrough();

export const WhatsAppEntrySchema = z
  .object({
    id: z.string(),
    changes: z.array(WhatsAppChangeSchema),
  })
  .passthrough();

export const WhatsAppWebhookPayloadSchema = z
  .object({
    object: z.string(),
    entry: z.array(WhatsAppEntrySchema),
  })
  .passthrough();

export type WhatsAppWebhookPayload = z.infer<typeof WhatsAppWebhookPayloadSchema>;
