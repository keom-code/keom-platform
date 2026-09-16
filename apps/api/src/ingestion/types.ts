/**
 * Provider-independent shapes. The ingestion layer only ever sees these — Meta's
 * nested webhook JSON stays isolated inside src/whatsapp.
 */

export interface NormalizedMessage {
  provider: "WHATSAPP";
  phoneNumberId: string;
  externalMessageId: string;
  externalCustomerId: string;
  customerName?: string;
  messageType: "TEXT";
  text: string;
  occurredAt: Date;
}

export interface NormalizedEntry {
  phoneNumberId: string;
  messages: NormalizedMessage[];
}

export interface NormalizedWebhookEvent {
  provider: "WHATSAPP";
  entries: NormalizedEntry[];
  rawPayload: unknown;
}
