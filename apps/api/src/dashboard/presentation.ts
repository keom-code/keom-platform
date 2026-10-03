import { NextBestAction, OpportunityState, RiskLevel, SignalType } from "@prisma/client";

/**
 * Phase 11: deterministic Spanish wording for the dashboard, built only from what M2A
 * already decided (state, risk, next best action, signals) and message timestamps. Pure
 * presentation — it never decides anything and calls no LLM. Spanish only for the pilot;
 * i18n would replace these maps, not the read models.
 */

const SIGNAL_PHRASES: Record<SignalType, string> = {
  PRICING_REQUESTED: "preguntó precios",
  AVAILABILITY_REQUESTED: "consultó disponibilidad",
  BOOKING_INTENT: "quiere reservar",
  PURCHASE_INTENT: "quiere comprar",
  QUOTE_REQUESTED: "pidió una cotización",
  PAYMENT_QUESTION: "preguntó por formas de pago",
  FOLLOW_UP_REQUESTED: "pidió que le escriban más tarde",
  OBJECTION: "expresó una duda u objeción",
  NO_LONGER_INTERESTED: "dijo que ya no está interesado",
};

const ACTION_TEXT: Record<NextBestAction, string> = {
  RESPOND: "Responder al cliente.",
  SEND_INFORMATION: "Enviar la información solicitada.",
  ASK_QUESTION: "Aclarar su consulta.",
  OFFER_APPOINTMENT: "Ofrecer un horario disponible.",
  FOLLOW_UP: "Hacer seguimiento.",
  WAIT: "Esperar.",
  ESCALATE_TO_HUMAN: "Atender personalmente.",
};

const STATE_REASON: Record<OpportunityState, string> = {
  AT_RISK: "En riesgo: sin respuesta del negocio",
  HIGH_INTENT: "Alta intención de compra",
  ENGAGED: "Interés comercial",
  NEW: "Nueva oportunidad",
};

export interface MessageTimes {
  lastInboundAt?: Date;
  lastOutboundAt?: Date;
}

export function requiredActionText(action: NextBestAction): string {
  return ACTION_TEXT[action];
}

export function adminReasonText(state: OpportunityState): string {
  return STATE_REASON[state];
}

/** "Juan Pérez García" -> { Juan, Pérez García }. WhatsApp profiles have one free-text name. */
export function splitName(name: string | null, phone: string): { firstName: string; lastName: string } {
  const trimmed = name?.trim();
  if (!trimmed) return { firstName: "Cliente", lastName: `+${phone}` };
  const [firstName, ...rest] = trimmed.split(/\s+/);
  return { firstName: firstName!, lastName: rest.join(" ") };
}

export function whatsappUrl(phone: string): string {
  return `https://wa.me/${phone.replace(/\D/g, "")}`;
}

/** "45 min", "3 h", "2 días". */
export function formatElapsed(ms: number): string {
  const minutes = Math.max(1, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "día" : "días"}`;
}

/** Whether the customer's latest message has no later business reply. */
export function isUnanswered(times: MessageTimes): boolean {
  return !!times.lastInboundAt && !(times.lastOutboundAt && times.lastOutboundAt >= times.lastInboundAt);
}

export function replyStatusText(times: MessageTimes, now: Date): string {
  if (isUnanswered(times)) return `Sin respuesta del negocio desde hace ${formatElapsed(now.getTime() - times.lastInboundAt!.getTime())}`;
  if (times.lastOutboundAt) return "Esperando respuesta del cliente";
  return "Sin actividad reciente";
}

/** "Juan preguntó precios y quiere reservar. Sin respuesta del negocio desde hace 2 h." */
export function summaryText(params: { firstName: string; signals: SignalType[]; state: OpportunityState; times: MessageTimes; now: Date }): string {
  const phrases = [...new Set(params.signals)].map((signal) => SIGNAL_PHRASES[signal]);
  const what = phrases.length > 0 ? `${params.firstName} ${joinSpanish(phrases)}.` : `${params.firstName} inició una conversación.`;
  const risk = params.state === "AT_RISK" ? " La oportunidad está en riesgo." : "";
  return `${what} ${replyStatusText(params.times, params.now)}.${risk}`;
}

export const RISK_ORDER: Record<RiskLevel, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

function joinSpanish(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}
