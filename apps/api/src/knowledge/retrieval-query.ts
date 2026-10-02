import { CommercialContextMessage, CommercialInterpretation } from "../llm/commercial-interpreter";
import { normalizeText } from "./text-normalizer";

/**
 * Bounded, deterministic retrieval query from a conversation (M3) — no extra LLM call to
 * rewrite it, and never the full history. Uses the latest customer message, plus the one
 * before it when the latest is too short to stand alone ("¿y el sábado?"), plus M2B's
 * serviceName/productName entities when the caller supplies them and they aren't already
 * in the text. M2B signal names are NOT appended: English enum labels add noise to
 * embeddings of Spanish messages.
 */
export const MAX_RETRIEVAL_QUERY_CHARS = 500;
export const SHORT_MESSAGE_CHARS = 40;

export function buildRetrievalQuery(
  messages: CommercialContextMessage[],
  entities?: Pick<CommercialInterpretation["entities"], "serviceName" | "productName">,
): string | null {
  const inbound = messages.map((message) => ({ ...message, text: normalizeText(message.text) })).filter((m) => m.direction === "INBOUND" && m.text);
  const latest = inbound[inbound.length - 1];
  if (!latest) return null;

  const parts = [latest.text];
  const previous = inbound[inbound.length - 2];
  if (latest.text.length < SHORT_MESSAGE_CHARS && previous) {
    parts.unshift(previous.text);
  }

  const text = parts.join(" ");
  for (const entity of [entities?.serviceName, entities?.productName]) {
    const value = entity?.trim();
    if (value && !text.toLowerCase().includes(value.toLowerCase())) {
      parts.push(value);
    }
  }

  return truncateAtWord(parts.join(" ").replace(/\s+/g, " ").trim(), MAX_RETRIEVAL_QUERY_CHARS);
}

function truncateAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max + 1).lastIndexOf(" ");
  return text.slice(0, cut > 0 ? cut : max);
}
