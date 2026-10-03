/**
 * Provider-independent shapes. The ingestion layer only ever sees these — Meta's
 * nested webhook JSON stays isolated inside src/whatsapp.
 */

export interface NormalizedMessage {
  provider: "WHATSAPP";
  /** INBOUND: the customer wrote. OUTBOUND: the business replied (seen via coexistence
   * echoes); KEOM itself sends nothing. */
  direction: "INBOUND" | "OUTBOUND";
  phoneNumberId: string;
  externalMessageId: string;
  /** The customer's WhatsApp id, whichever side sent the message. */
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
  /** Provider event kind(s) for the RawEvent audit row, e.g. "messages" or
   * "smb_message_echoes". Defaults to "messages". */
  eventType?: string;
  entries: NormalizedEntry[];
  rawPayload: unknown;
}
