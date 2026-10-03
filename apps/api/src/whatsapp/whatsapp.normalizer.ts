import { NormalizedEntry, NormalizedMessage } from "../ingestion/types";
import { WhatsAppWebhookPayload } from "./whatsapp-webhook.schema";

type WhatsAppValue = WhatsAppWebhookPayload["entry"][number]["changes"][number]["value"];

/**
 * Meta payload -> NormalizedEntry[]. One entry per webhook "change" (each carries its
 * own metadata.phone_number_id, which is what tenant resolution keys off).
 * Only text messages are handled; other message types are skipped, not rejected.
 *
 * Two change fields are read:
 * - "messages": customer -> business (INBOUND).
 * - "smb_message_echoes": business -> customer, sent from the WhatsApp Business app on a
 *   number onboarded in coexistence mode (OUTBOUND). This is how KEOM learns a seller
 *   replied, which M4's "no business reply" re-evaluation depends on.
 * Everything else (statuses, history, app state sync...) is ignored.
 */
export function normalizeWhatsAppWebhook(payload: WhatsAppWebhookPayload): NormalizedEntry[] {
  const entries: NormalizedEntry[] = [];

  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      if (change.field === "smb_message_echoes") {
        entries.push({ phoneNumberId: change.value.metadata.phone_number_id, messages: normalizeEchoes(change.value) });
        continue;
      }
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
          direction: "INBOUND",
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

function normalizeEchoes(value: WhatsAppValue): NormalizedMessage[] {
  return (value.message_echoes ?? [])
    .filter((echo) => echo.type === "text" && echo.text)
    .map((echo) => ({
      provider: "WHATSAPP",
      direction: "OUTBOUND",
      phoneNumberId: value.metadata.phone_number_id,
      externalMessageId: echo.id,
      externalCustomerId: echo.to,
      messageType: "TEXT",
      text: echo.text!.body,
      occurredAt: new Date(Number(echo.timestamp) * 1000),
    }));
}
