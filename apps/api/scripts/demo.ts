import { randomInt } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { WHATSAPP_DEMO_PHONE_NUMBER_ID, WHATSAPP_DEMO_WABA_ID } from "@keom/mocks";

/**
 * End-to-end demo of everything built so far (M1 -> M2B -> M2A -> M3), run against the
 * live API with real providers. Every step prints what it means for the business ("Negocio")
 * and what happened technically ("Técnico"). Guide: docs/DEMO.md.
 *
 * Keep this script and docs/DEMO.md in sync with every milestone.
 *
 * Repeatable without resetting the database: each run uses a new customer phone number (so
 * a new Customer/Conversation/Opportunity), and the demo companies' knowledge is reloaded
 * from scratch at the start.
 */

const API = process.env.DEMO_API_URL ?? "http://localhost:3001";
const CLINIC_ID = "00000000-0000-4000-8000-000000000001"; // "Clínica Demo" (prisma/seed.ts)
const SAAS_ID = "00000000-0000-4000-8000-000000000003"; // "SaaS Demo" (prisma/seed.ts)

const CLINIC_KNOWLEDGE = [
  {
    title: "Depilación láser — preguntas frecuentes",
    metadata: { categoria: "precios" },
    content: "La depilación láser de piernas cuesta S/320 por sesión.\nAtendemos los sábados de 9 AM a 5 PM.\nLas citas requieren confirmación.",
  },
  {
    title: "Política de cancelación",
    metadata: { categoria: "politicas" },
    content: "Puedes cancelar o reprogramar tu cita sin costo hasta 24 horas antes. Las cancelaciones con menos de 24 horas pierden el adelanto.",
  },
];

const SAAS_KNOWLEDGE = [
  {
    title: "Plan Business",
    metadata: { categoria: "planes" },
    content: "El Plan Business cuesta $99 al mes.\nIncluye 20 usuarios, acceso a la API y soporte por email.\nLas suscripciones anuales tienen 15% de descuento.",
  },
];

const prisma = new PrismaClient();
interface Customer {
  name: string;
  phone: string;
}

const newPhone = () => `519${randomInt(10_000_000, 99_999_999)}`;
const ANDREA: Customer = { name: "Andrea", phone: newPhone() };
const runId = Date.now();
let messageCount = 0;

// ---------------------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------------------

const bold = (text: string) => `\x1b[1m${text}\x1b[0m`;
const dim = (text: string) => `\x1b[2m${text}\x1b[0m`;
const green = (text: string) => `\x1b[32m${text}\x1b[0m`;
const yellow = (text: string) => `\x1b[33m${text}\x1b[0m`;

function step(title: string, business: string) {
  console.log(`\n${bold("━".repeat(78))}\n${bold(title)}\n${bold("━".repeat(78))}`);
  console.log(`${green("Negocio:")} ${business}`);
}

function tech(label: string, value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  console.log(`  ${dim("Técnico ·")} ${label}: ${text}`);
}

function say(label: string, text: string) {
  console.log(`  ${yellow(label)} ${text}`);
}

// ---------------------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------------------

// Responses are only printed here, so they stay loosely typed (the API's own tests cover shapes).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(`No se pudo conectar a ${API}. ¿Está corriendo la API? (cd apps/api && pnpm dev)`);
  }
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${path} -> HTTP ${response.status}: ${text}`);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

/** M1: deliver a customer message through the real WhatsApp webhook path. */
async function customerSays(text: string, customer: Customer = ANDREA): Promise<string> {
  messageCount += 1;
  await call("POST", "/webhooks/whatsapp", {
    object: "whatsapp_business_account",
    entry: [
      {
        id: WHATSAPP_DEMO_WABA_ID,
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "51999888777", phone_number_id: WHATSAPP_DEMO_PHONE_NUMBER_ID },
              contacts: [{ profile: { name: customer.name }, wa_id: customer.phone }],
              messages: [
                {
                  from: customer.phone,
                  id: `wamid.demo-${runId}-${messageCount}`,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: "text",
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  });

  const conversation = await prisma.conversation.findFirstOrThrow({
    where: { companyId: CLINIC_ID, customer: { externalId: customer.phone } },
    include: { _count: { select: { messages: true } } },
  });
  say(`${customer.name}:`, `"${text}"`);
  tech("M1 webhook", `mensaje guardado (conversación ${conversation.id}, ${conversation._count.messages} mensaje(s))`);
  return conversation.id;
}

/** M2B interprets the conversation, M2A decides; returns the interpretation for M3. */
async function interpretAndDecide(conversationId: string) {
  const { interpretation, opportunity, reevaluation } = await call("POST", "/dev/interpretation/evaluate", { conversationId });
  tech("M2B interpretación", { intent: interpretation.intent, interest: interpretation.interestLevel, signals: interpretation.signals, entities: interpretation.entities });
  if (opportunity.noOp) {
    tech("M2A decisión", "sin señales comerciales: no se crea oportunidad");
  } else {
    tech("M2A decisión", { state: opportunity.state, priority: opportunity.priority, risk: opportunity.risk, score: opportunity.score, nextBestAction: opportunity.nextBestAction });
    tech("M2A motivo", opportunity.reasons.action);
  }
  describeSchedule(reevaluation);
  return { interpretation, opportunityId: opportunity.opportunityId as string | undefined, reevaluation: reevaluation as Schedule | null };
}

interface Schedule {
  status: "SCHEDULED" | "NOTHING_TO_SCHEDULE" | "DISABLED" | "FAILED";
  jobs: { trigger: string; scheduledFor: string }[];
  error?: string;
}

/** M4: what the evaluation scheduled for later. */
function describeSchedule(schedule: Schedule | null) {
  if (!schedule) return;
  const jobs = schedule.jobs.map((job) => `${job.trigger} a las ${new Date(job.scheduledFor).toLocaleTimeString()}`).join("; ");
  tech("M4 reevaluación", schedule.status === "SCHEDULED" ? `programada: ${jobs}` : `${schedule.status}${schedule.error ? ` (${schedule.error})` : ""}`);
}

async function opportunityState(opportunityId: string) {
  return prisma.opportunity.findUniqueOrThrow({
    where: { id: opportunityId },
    select: { state: true, risk: true, priority: true, score: true, lastEvaluatedAt: true },
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** M3 suggests a reply grounded only in the clinic's knowledge. */
async function suggestReply(conversationId: string, interpretation?: unknown) {
  const result = await call("POST", "/dev/knowledge/suggest-response", { conversationId, interpretation });
  tech("M3 búsqueda", `"${result.retrievalQuery}"`);
  if (result.status === "GROUNDED") {
    say("Sugerencia para el vendedor:", `"${result.suggestedResponse}"`);
    tech(
      "M3 fuentes",
      result.sources.map((s: { title: string; similarity: number }) => `${s.title} (similitud ${s.similarity.toFixed(2)})`).join("; "),
    );
  } else {
    say("Sugerencia para el vendedor:", "(ninguna — no hay información suficiente)");
  }
  tech("M3 resultado", { status: result.status, requiresLiveVerification: result.requiresLiveVerification });
}

async function reloadKnowledge(companyId: string, documents: typeof CLINIC_KNOWLEDGE) {
  const { documents: existing } = await call<{ documents: { id: string }[] }>("GET", `/dev/knowledge/documents?companyId=${companyId}`);
  for (const document of existing) {
    await call("DELETE", `/dev/knowledge/documents/${document.id}?companyId=${companyId}`);
  }
  for (const document of documents) {
    const { document: created } = await call("POST", "/dev/knowledge/documents", { companyId, ...document });
    tech("M3 documento indexado", `"${created.title}" → ${created.chunkCount} fragmento(s) con embedding en pgvector`);
  }
}

async function search(companyId: string, query: string) {
  const { chunks, minSimilarity } = await call("POST", "/dev/knowledge/search", { companyId, query });
  return { minSimilarity, chunks: chunks as { title: string; similarity: number }[] };
}

// ---------------------------------------------------------------------------------------
// The story
// ---------------------------------------------------------------------------------------

async function main() {
  console.log(bold("\nKEOM — demo completa (M1 → M2B → M2A → M3)"));
  console.log(dim(`API: ${API} · clienta de prueba: Andrea (${ANDREA.phone})`));

  step(
    "PASO 1 — La clínica carga su información",
    "Cada negocio carga sus precios, horarios y políticas. KEOM solo usará esto para sugerir respuestas.",
  );
  await reloadKnowledge(CLINIC_ID, CLINIC_KNOWLEDGE);

  step(
    "PASO 2 — Andrea pregunta precio y horario",
    "La IA entiende qué quiere, el motor decide qué hacer y KEOM sugiere qué responder con datos reales de la clínica.",
  );
  let conversationId = await customerSays("Hola, ¿cuánto cuesta la depilación de piernas y atienden el sábado?");
  let { interpretation } = await interpretAndDecide(conversationId);
  await suggestReply(conversationId, interpretation);

  step(
    "PASO 3 — Andrea quiere reservar un horario concreto",
    "La oportunidad sube de prioridad. KEOM sabe el horario general, pero no confirma un turno libre: eso es un dato en vivo (calendario) que todavía no tenemos.",
  );
  conversationId = await customerSays("Perfecto, resérvame este sábado a las 3 pm por favor");
  ({ interpretation } = await interpretAndDecide(conversationId));
  await suggestReply(conversationId, interpretation);

  step(
    "PASO 4 — Andrea pregunta por cancelaciones",
    "KEOM usa otro documento de la clínica (la política de cancelación) para responder.",
  );
  conversationId = await customerSays("¿Y si al final no puedo ir, puedo cancelar sin costo?");
  ({ interpretation } = await interpretAndDecide(conversationId));
  await suggestReply(conversationId, interpretation);

  step(
    "PASO 5 — Andrea pregunta algo que la clínica no cargó",
    "Si la información no existe, KEOM no inventa: no sugiere nada y el vendedor responde.",
  );
  conversationId = await customerSays("Otra consulta: ¿hacen envíos de productos a provincia?");
  ({ interpretation } = await interpretAndDecide(conversationId));
  await suggestReply(conversationId, interpretation);

  step(
    "PASO 6 — Otro rubro, la misma estructura, información aislada",
    "Una empresa de software usa exactamente el mismo sistema. Cada negocio solo ve su propia información.",
  );
  await reloadKnowledge(SAAS_ID, SAAS_KNOWLEDGE);
  const question = "¿Cuánto cuesta el plan y cuántos usuarios incluye?";
  const saas = await search(SAAS_ID, question);
  const clinic = await search(CLINIC_ID, question);
  say("Pregunta:", `"${question}"`);
  tech("búsqueda en SaaS Demo", saas.chunks.map((c) => `${c.title} (similitud ${c.similarity.toFixed(2)})`).join("; ") || "sin resultados");
  tech("misma búsqueda en Clínica Demo", clinic.chunks.map((c) => `${c.title} (similitud ${c.similarity.toFixed(2)})`).join("; ") || "sin resultados (aislada)");
  tech("umbral de similitud", clinic.minSimilarity);

  await timePasses();

  console.log(`\n${bold("Fin.")} ${dim("Nada se envió por WhatsApp: KEOM solo sugiere. Ver docs/DEMO.md para leer cada paso.")}\n`);
}

/**
 * M4: two customers ask to book; the business answers only one of them. When the scheduled
 * checks fire, M2A re-evaluates both on fresh data. Needs the API started with REDIS_URL and,
 * to fit in a demo, short M2A thresholds (docs/DEMO.md, "Preparar").
 */
async function timePasses() {
  step(
    "PASO 7 — El tiempo pasa: ¿alguien respondió?",
    "Dos clientas quieren reservar. El negocio le responde solo a una. KEOM vuelve a mirar las dos más tarde: la que quedó sin respuesta pasa a riesgo; la otra no.",
  );
  const lucia: Customer = { name: "Lucía", phone: newPhone() };
  const mateo: Customer = { name: "Mateo", phone: newPhone() };

  const luciaConversation = await customerSays("Sí, quiero reservar para el sábado", lucia);
  const luciaResult = await interpretAndDecide(luciaConversation);
  const mateoConversation = await customerSays("Sí, quiero reservar para el sábado", mateo);
  const mateoResult = await interpretAndDecide(mateoConversation);

  await call("POST", `/dev/conversations/${mateoConversation}/business-replies`, { companyId: CLINIC_ID, text: "¡Hola Mateo! Te reservo el sábado." });
  say("Negocio a Mateo:", `"¡Hola Mateo! Te reservo el sábado."`);
  tech("respuesta del negocio", "registrada como mensaje OUTBOUND (endpoint de desarrollo; no se envía nada)");

  const schedule = luciaResult.reevaluation;
  if (!schedule || schedule.status !== "SCHEDULED" || !luciaResult.opportunityId || !mateoResult.opportunityId) {
    tech("M4", `no hay chequeos programados (${schedule?.status ?? "sin oportunidad"}). Arranca la API con REDIS_URL para ver este paso.`);
    return;
  }
  const lastCheck = Math.max(...schedule.jobs.map((job) => Date.parse(job.scheduledFor)));
  const waitMs = lastCheck - Date.now() + 5_000;
  if (waitMs > 5 * 60_000) {
    tech("M4", `el último chequeo corre a las ${new Date(lastCheck).toLocaleTimeString()} (umbrales por defecto 1h/4h). Para verlo ahora usa OPPORTUNITY_STALL_MEDIUM_MINUTES=1 y OPPORTUNITY_STALL_HIGH_MINUTES=2.`);
    return;
  }

  const before = { lucia: await opportunityState(luciaResult.opportunityId), mateo: await opportunityState(mateoResult.opportunityId) };
  process.stdout.write(`  ${dim(`Esperando ${Math.round(waitMs / 1000)}s a que corran los chequeos `)}`);
  for (let waited = 0; waited < waitMs; waited += 10_000) {
    await sleep(Math.min(10_000, waitMs - waited));
    process.stdout.write(dim("."));
  }
  console.log();

  for (const [name, id, previous] of [
    ["Lucía (sin respuesta)", luciaResult.opportunityId, before.lucia],
    ["Mateo (le respondieron)", mateoResult.opportunityId, before.mateo],
  ] as const) {
    const now = await opportunityState(id);
    const changed = now.state !== previous.state || now.risk !== previous.risk;
    tech(
      `M4 → M2A ${name}`,
      `${previous.state}/riesgo ${previous.risk} → ${now.state}/riesgo ${now.risk}${changed ? "" : " (sin cambios: no se escribió nada)"}`,
    );
  }
}

main()
  .catch((err: Error) => {
    console.error(`\n\x1b[31mLa demo se detuvo:\x1b[0m ${err.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
