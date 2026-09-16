import { receivedTextMessageWebhook, WHATSAPP_DEMO_CUSTOMER_WA_ID, WHATSAPP_DEMO_PHONE_NUMBER_ID } from "@keom/mocks";
import { normalizeWhatsAppWebhook } from "./whatsapp.normalizer";
import { WhatsAppWebhookPayloadSchema } from "./whatsapp-webhook.schema";

describe("normalizeWhatsAppWebhook", () => {
  it("normalizes an official Meta-shaped inbound text webhook into a NormalizedMessage", () => {
    const payload = WhatsAppWebhookPayloadSchema.parse(receivedTextMessageWebhook);

    const entries = normalizeWhatsAppWebhook(payload);

    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry!.phoneNumberId).toBe(WHATSAPP_DEMO_PHONE_NUMBER_ID);
    expect(entry!.messages).toHaveLength(1);

    const [message] = entry!.messages;
    expect(message).toMatchObject({
      provider: "WHATSAPP",
      phoneNumberId: WHATSAPP_DEMO_PHONE_NUMBER_ID,
      externalCustomerId: WHATSAPP_DEMO_CUSTOMER_WA_ID,
      customerName: "Andrea Torres",
      messageType: "TEXT",
      text: "Hola, ¿cuánto cuesta y tienen disponibilidad el sábado?",
    });
    expect(message!.externalMessageId).toMatch(/^wamid\./);
    expect(message!.occurredAt).toBeInstanceOf(Date);
    expect(message!.occurredAt.getTime()).toBe(1758000000 * 1000);
  });

  it("skips non-text messages without throwing", () => {
    const payload = WhatsAppWebhookPayloadSchema.parse({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "waba-id",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { phone_number_id: "123" },
                messages: [{ from: "51900000000", id: "wamid.abc", timestamp: "1758000000", type: "image" }],
              },
            },
          ],
        },
      ],
    });

    const entries = normalizeWhatsAppWebhook(payload);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.messages).toHaveLength(0);
  });
});
