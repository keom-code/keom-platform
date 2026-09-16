import { NormalizedEntry, NormalizedMessage } from "../ingestion/types";
import { WhatsAppWebhookPayload } from "./whatsapp-webhook.schema";

/**
 * Meta payload -> NormalizedEntry[]. One entry per webhook "change" (each carries its
 * own metadata.phone_number_id, which is what tenant resolution keys off).
 * M1 only handles text messages; other message types are skipped, not rejected.
 */
export function normalizeWhatsAppWebhook(payload: WhatsAppWebhookPayload): NormalizedEntry[] {
  const entries: NormalizedEntry[] = [];

  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      if (change.field !== "messages") continue;

      const { value } = change;
      const phoneNumberId = value.metadata.phone_number_id;
      const contactNameByWaId = new Map(
        (value.contacts ?? []).map((contact) => [contact.wa_id, contact.profile?.name]),
      );

      const messages: NormalizedMessage[] = [];
      for (const message of value.messages ?? []) {
        if (message.type !== "text" || !message.text) continue;

        messages.push({
          provider: "WHATSAPP",
          phoneNumberId,
          externalMessageId: message.id,
          externalCustomerId: message.from,
          customerName: contactNameByWaId.get(message.from),
          messageType: "TEXT",
          text: message.text.body,
          occurredAt: new Date(Number(message.timestamp) * 1000),
        });
      }

      entries.push({ phoneNumberId, messages });
    }
  }

  return entries;
}
