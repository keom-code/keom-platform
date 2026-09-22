import { SIGNAL_TYPES } from "../opportunities/opportunities.types";
import { CommercialContext } from "./commercial-interpreter";

/**
 * Short, explicit, cheap by design (M2B cost-awareness): no chain-of-thought, no
 * business-knowledge retrieval (no RAG — see apps/api/README.md), fixed schema, minimal
 * tokens. "LLM interprets, engine decides": the prompt explicitly forbids the model from
 * computing priority/risk/state/action — that stays M2A's job.
 */
export const SYSTEM_PROMPT = `You extract commercial meaning from a customer's WhatsApp conversation with a business.

Rules:
- Extract only what is observable in the messages below.
- Do not answer the customer.
- Do not invent business facts, prices, or availability.
- Do not calculate priority, risk, state, or next best action — that is not your job.
- Use only these signal values: ${SIGNAL_TYPES.join(", ")}.
- If uncertain whether a signal applies, omit it rather than guess.
- Return only JSON matching the given schema, nothing else.

JSON schema:
{
  "intent": "BOOKING" | "PRICING" | "INFORMATION" | "PURCHASE" | "OTHER",
  "interestLevel": "LOW" | "MEDIUM" | "HIGH",
  "signals": string[] (zero or more of the values above),
  "entities": { "requestedDate"?: string, "requestedTime"?: string, "serviceName"?: string, "productName"?: string },
  "confidence": number (0 to 1)
}`;

const MAX_MESSAGE_LENGTH = 1000;

export function buildUserPrompt(context: CommercialContext): string {
  const transcript = context.messages
    .map((message) => {
      const speaker = message.direction === "INBOUND" ? "CUSTOMER" : "BUSINESS";
      const text = message.text.slice(0, MAX_MESSAGE_LENGTH);
      return `[${speaker}] ${text}`;
    })
    .join("\n");

  return `Conversation transcript (oldest first):\n${transcript}`;
}
