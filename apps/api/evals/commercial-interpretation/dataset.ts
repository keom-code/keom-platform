import { readFileSync } from "node:fs";
import { z } from "zod";
import { MAX_MESSAGES } from "../../src/interpretation/context-builder.service";
import { CommercialInterpretationSchema } from "../../src/llm/commercial-interpretation.schema";
import { CommercialContext } from "../../src/llm/commercial-interpreter";
import { INTEREST_LEVELS, InterestLevel, SIGNAL_TYPES, SignalType } from "../../src/opportunities/opportunities.types";

/**
 * Human-labeled evaluation set for comparing CommercialInterpreter providers offline.
 * Labels reuse the production enums (CommercialInterpretationSchema intents,
 * SIGNAL_TYPES, INTEREST_LEVELS) so an invalid label fails loading instead of skewing
 * metrics. No provider output is ever written back into this file.
 */
const intentSchema = CommercialInterpretationSchema.shape.intent;
const interestSchema = z.enum(INTEREST_LEVELS as [InterestLevel, ...InterestLevel[]]);
const signalSchema = z.enum(SIGNAL_TYPES as [SignalType, ...SignalType[]]);

const EvalCaseSchema = z.object({
  id: z.string().min(1),
  tags: z.array(z.string()),
  messages: z.array(z.object({ direction: z.enum(["INBOUND", "OUTBOUND"]), text: z.string() })).min(1),
  expected: z.object({
    intent: intentSchema,
    interestLevel: interestSchema,
    signals: z.array(signalSchema),
  }),
  acceptableIntents: z.array(intentSchema).optional(),
  acceptableInterestLevels: z.array(interestSchema).optional(),
  notes: z.string().optional(),
  review: z.object({
    status: z.enum(["draft", "reviewed"]),
    reviewer: z.string().nullable(),
    reviewedAt: z.string().nullable(),
  }),
});

const EvalDatasetSchema = z.object({
  version: z.string(),
  description: z.string(),
  labelingGuide: z.array(z.string()),
  cases: z.array(EvalCaseSchema).min(1),
});

export type EvalCase = z.infer<typeof EvalCaseSchema>;
export type EvalDataset = z.infer<typeof EvalDatasetSchema>;

export function loadDataset(path: string): EvalDataset {
  const dataset = EvalDatasetSchema.parse(JSON.parse(readFileSync(path, "utf-8")));
  const ids = new Set<string>();
  for (const evalCase of dataset.cases) {
    if (ids.has(evalCase.id)) throw new Error(`Duplicate eval case id "${evalCase.id}"`);
    ids.add(evalCase.id);
  }
  return dataset;
}

/** Fixed clock so M2A's time-based risk rule is identical across runs and providers. */
export const EVAL_BASE_TIME = new Date("2026-01-05T15:00:00Z");
const MESSAGE_SPACING_MS = 60_000;

/** Same bounds as ContextBuilderService: last MAX_MESSAGES messages, oldest first.
 * (Per-message truncation happens inside buildUserPrompt, shared by both providers.) */
export function toCommercialContext(evalCase: EvalCase): CommercialContext {
  const messages = evalCase.messages.map((message, index) => ({
    direction: message.direction,
    text: message.text,
    sentAt: new Date(EVAL_BASE_TIME.getTime() + index * MESSAGE_SPACING_MS),
  }));
  return { conversationId: `eval:${evalCase.id}`, messages: messages.slice(-MAX_MESSAGES) };
}

/** "now" for the M2A replay: shortly after the last message. */
export function evalNow(context: CommercialContext): Date {
  const last = context.messages[context.messages.length - 1];
  return new Date((last?.sentAt ?? EVAL_BASE_TIME).getTime() + 5 * 60_000);
}
