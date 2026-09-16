/**
 * Fixture matching the current official Meta WhatsApp Cloud API inbound-text webhook
 * shape (verified against developers.facebook.com/docs/whatsapp/cloud-api/webhooks
 * as of this fixture's authoring). Fake/demo data only.
 *
 * Demo scenario: Clínica Demo receives a WhatsApp message from Andrea Torres.
 */

export const WHATSAPP_DEMO_WABA_ID = "102290129340398";
export const WHATSAPP_DEMO_PHONE_NUMBER_ID = "109876543210987";
export const WHATSAPP_DEMO_CUSTOMER_WA_ID = "51987654321";

export const receivedTextMessageWebhook = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: WHATSAPP_DEMO_WABA_ID,
      changes: [
        {
          value: {
            messaging_product: "whatsapp",
            metadata: {
              display_phone_number: "51999888777",
              phone_number_id: WHATSAPP_DEMO_PHONE_NUMBER_ID,
            },
            contacts: [
              {
                profile: { name: "Andrea Torres" },
                wa_id: WHATSAPP_DEMO_CUSTOMER_WA_ID,
              },
            ],
            messages: [
              {
                from: WHATSAPP_DEMO_CUSTOMER_WA_ID,
                id: "wamid.HBgLNTE5ODc2NTQzMjEVAgASGBQzQTRBNjU5OUFFRTAzODEwMTQ0RgA=",
                timestamp: "1758000000",
                type: "text",
                text: {
                  body: "Hola, ¿cuánto cuesta y tienen disponibilidad el sábado?",
                },
              },
            ],
          },
          field: "messages",
        },
      ],
    },
  ],
} as const;
