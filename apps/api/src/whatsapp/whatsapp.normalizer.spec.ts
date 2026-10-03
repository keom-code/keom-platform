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

  /** Meta's documented smb_message_echoes example, with the demo phone_number_id. */
  function echoPayload(echo: Record<string, unknown>) {
    return WhatsAppWebhookPayloadSchema.parse({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "102290129340398",
          changes: [
            {
              field: "smb_message_echoes",
              value: {
                messaging_product: "whatsapp",
                metadata: { display_phone_number: "15550783881", phone_number_id: WHATSAPP_DEMO_PHONE_NUMBER_ID },
                message_echoes: [echo],
              },
            },
          ],
        },
      ],
    });
  }

  it("normalizes a coexistence echo (business reply from the WhatsApp Business app) as OUTBOUND to the customer", () => {
    const entries = normalizeWhatsAppWebhook(
      echoPayload({
        from: "15550783881",
        to: WHATSAPP_DEMO_CUSTOMER_WA_ID,
        id: "wamid.HBgLMTY0NjcwNDM1OTUVAgARGBIyNDlBOEI5QUQ4NDc0N0FCNjMA",
        timestamp: "1739321024",
        type: "text",
        text: { body: "Here's the info you requested!" },
      }),
    );

    expect(entries).toEqual([
      {
        phoneNumberId: WHATSAPP_DEMO_PHONE_NUMBER_ID,
        messages: [
          {
            provider: "WHATSAPP",
            direction: "OUTBOUND",
            phoneNumberId: WHATSAPP_DEMO_PHONE_NUMBER_ID,
            externalMessageId: "wamid.HBgLMTY0NjcwNDM1OTUVAgARGBIyNDlBOEI5QUQ4NDc0N0FCNjMA",
            externalCustomerId: WHATSAPP_DEMO_CUSTOMER_WA_ID,
            messageType: "TEXT",
            text: "Here's the info you requested!",
            occurredAt: new Date(1739321024 * 1000),
          },
        ],
      },
    ]);
  });

  it("marks customer messages as INBOUND and skips non-text echoes", () => {
    const inbound = normalizeWhatsAppWebhook(WhatsAppWebhookPayloadSchema.parse(receivedTextMessageWebhook));
    expect(inbound[0]!.messages[0]!.direction).toBe("INBOUND");

    const image = normalizeWhatsAppWebhook(
      echoPayload({ from: "15550783881", to: WHATSAPP_DEMO_CUSTOMER_WA_ID, id: "wamid.x", timestamp: "1739321024", type: "image", image: { id: "1" } }),
    );
    expect(image[0]!.messages).toEqual([]);
  });
});
