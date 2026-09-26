import { Injectable, Logger } from "@nestjs/common";
import { APIError, APITimeoutError, APIUserAbortError, TypeSafeClient } from "@typesafe-ai/sdk";
import { z } from "zod";
import { INTEREST_LEVELS, SignalType, SIGNAL_TYPES } from "../opportunities/opportunities.types";
import { CommercialInterpretationSchema } from "./commercial-interpretation.schema";
import {
  CommercialContext,
  CommercialInterpretation,
  DiagnosableCommercialInterpreter,
  DiagnosedInterpretation,
  InterpretationDiagnostics,
  InterpretationError,
} from "./commercial-interpreter";
import { buildJevQuestions, JEV_INTENT_LABELS } from "./jev-questions";
import { JEV_CHOICE_MIN_CONFIDENCE, JEV_SIGNAL_THRESHOLDS, JEV_THRESHOLDS_VERSION } from "./jev-thresholds";
import { JevConfig, loadJevConfig } from "./llm.config";
import { buildUserPrompt } from "./prompt";

/**
 * Jev (TypeSafe AI System One) CommercialInterpreter — an experimental alternative to
 * OpenAI behind the same interface, selected only via LLM_PROVIDER=jev. "Jev interprets,
 * M2A decides": it classifies intent/interest/signals only.
 *
 * - `state` is exactly buildUserPrompt(context), the transcript OpenAI receives, so both
 *   providers see identical context (same last-10 messages, 1000-char cap, role tags).
 * - `entities` is always `{}`: Jev does not generate free text, and entity extraction is
 *   deferred for this experiment (M2A and the mapper ignore entities).
 * - Uncertainty never becomes an empty success: any answer inside its threshold band
 *   throws UNCERTAIN_OUTPUT, so InterpretationService never reaches M2A (see
 *   jev-thresholds.ts).
 * - `confidence` is a Jev-specific heuristic — the weakest of the two Choice confidences
 *   and each signal's decisiveness |2p - 1| — not a calibrated probability and not
 *   comparable with OpenAI's self-reported confidence.
 */
@Injectable()
export class JevCommercialInterpreter implements DiagnosableCommercialInterpreter {
  private readonly logger = new Logger(JevCommercialInterpreter.name);

  async interpret(context: CommercialContext): Promise<CommercialInterpretation> {
    return (await this.interpretWithDiagnostics(context)).interpretation;
  }

  async interpretWithDiagnostics(context: CommercialContext): Promise<DiagnosedInterpretation> {
    const config = loadJevConfig();
    const client = this.createClient(config);

    const startedAt = Date.now();
    const result = await this.request(client, config, context);
    const latencyMs = Date.now() - startedAt;

    const diagnostics: InterpretationDiagnostics = {
      provider: "jev",
      model: typeof result?.model === "string" ? result.model : config.model,
      latencyMs,
      usage: parseUsage(result?.usage),
    };
    this.logger.debug(`Jev model=${diagnostics.model} latencyMs=${latencyMs} usage=${JSON.stringify(diagnostics.usage)}`);

    const answers = parseJevAnswers(result?.answers, diagnostics);
    diagnostics.raw = { thresholdsVersion: JEV_THRESHOLDS_VERSION, answers };

    return { interpretation: mapJevAnswers(answers, diagnostics), diagnostics };
  }

  /** Extracted so tests can override this one seam (subclass + stub) instead of
   * mocking the SDK module. */
  protected createClient(config: JevConfig): Pick<TypeSafeClient, "systemOne"> {
    // logLevel pinned to "warn": the SDK logs request bodies (conversation text) at
    // "debug", and TYPESAFE_LOG_LEVEL would otherwise be able to turn that on.
    return new TypeSafeClient({ apiKey: config.apiKey, timeout: config.timeoutMs, logLevel: "warn" });
  }

  /** Returns the untyped body: the SDK does not validate responses, so parseJevAnswers
   * treats it as unknown input. */
  private async request(
    client: Pick<TypeSafeClient, "systemOne">,
    config: JevConfig,
    context: CommercialContext,
  ): Promise<{ model?: unknown; answers?: unknown; usage?: unknown }> {
    // The SDK's timeout is per attempt with no total retry budget; this signal bounds
    // the whole call, retries included, to LLM_TIMEOUT_MS.
    const budget = AbortSignal.timeout(config.timeoutMs);
    try {
      return await client.systemOne(
        { state: buildUserPrompt(context), questions: buildJevQuestions(), model: config.model },
        { signal: budget },
      );
    } catch (err) {
      if (budget.aborted || err instanceof APIUserAbortError || err instanceof APITimeoutError) {
        throw new InterpretationError("PROVIDER_TIMEOUT", "Jev request timed out.", err);
      }
      if (err instanceof APIError) {
        throw new InterpretationError("PROVIDER_ERROR", `Jev request failed with HTTP ${err.status}.`, err);
      }
      throw new InterpretationError("PROVIDER_ERROR", "Jev request failed.", err);
    }
  }
}

const probability = z.number().finite().min(0).max(1);

function choiceAnswerSchema<L extends string>(labels: readonly [L, ...L[]]) {
  return z.object({
    type: z.literal("choice"),
    choice: z.enum(labels),
    confidence: probability,
    probabilities: z.object(Object.fromEntries(labels.map((label) => [label, probability])) as Record<L, typeof probability>),
  });
}

const noulAnswerSchema = z.object({ type: z.literal("noul"), noul: probability });

const JevAnswersSchema = z.object({
  intent: choiceAnswerSchema(JEV_INTENT_LABELS),
  interestLevel: choiceAnswerSchema(INTEREST_LEVELS as [(typeof INTEREST_LEVELS)[number], ...(typeof INTEREST_LEVELS)[number][]]),
  ...(Object.fromEntries(SIGNAL_TYPES.map((signal) => [signal, noulAnswerSchema])) as Record<SignalType, typeof noulAnswerSchema>),
});

export type JevAnswers = z.infer<typeof JevAnswersSchema>;

/** Every question must come back with the right answer type, a known label and finite
 * probabilities in [0, 1] — a missing or malformed answer is INVALID_OUTPUT, never a
 * silently absent signal. */
export function parseJevAnswers(raw: unknown, diagnostics?: InterpretationDiagnostics): JevAnswers {
  const parsed = JevAnswersSchema.safeParse(raw);
  if (!parsed.success) {
    throw new InterpretationError("INVALID_OUTPUT", `Jev answers failed validation: ${parsed.error.message}`, parsed.error, diagnostics);
  }
  return parsed.data;
}

export function mapJevAnswers(answers: JevAnswers, diagnostics?: InterpretationDiagnostics): CommercialInterpretation {
  const uncertain: string[] = [];

  for (const key of ["intent", "interestLevel"] as const) {
    if (answers[key].confidence < JEV_CHOICE_MIN_CONFIDENCE) {
      uncertain.push(`${key}(confidence=${answers[key].confidence})`);
    }
  }

  const signals: SignalType[] = [];
  for (const signal of SIGNAL_TYPES) {
    const p = answers[signal].noul;
    const { yesAt, noAt } = JEV_SIGNAL_THRESHOLDS[signal];
    if (p >= yesAt) signals.push(signal);
    else if (p > noAt) uncertain.push(`${signal}(p=${p})`);
  }

  if (uncertain.length > 0) {
    throw new InterpretationError(
      "UNCERTAIN_OUTPUT",
      `Jev answers inside the uncertainty band (thresholds ${JEV_THRESHOLDS_VERSION}): ${uncertain.join(", ")}`,
      undefined,
      diagnostics,
    );
  }

  const confidence = Math.min(
    answers.intent.confidence,
    answers.interestLevel.confidence,
    ...SIGNAL_TYPES.map((signal) => Math.abs(2 * answers[signal].noul - 1)),
  );

  const result = CommercialInterpretationSchema.safeParse({
    intent: answers.intent.choice,
    interestLevel: answers.interestLevel.choice,
    signals,
    entities: {},
    confidence,
  });
  if (!result.success) {
    throw new InterpretationError("INVALID_OUTPUT", `Mapped Jev output failed schema validation: ${result.error.message}`, result.error, diagnostics);
  }
  return result.data;
}

function parseUsage(raw: unknown): InterpretationDiagnostics["usage"] {
  const parsed = z.object({ input_tokens: z.number(), output_tokens: z.number() }).safeParse(raw);
  return parsed.success ? { inputTokens: parsed.data.input_tokens, outputTokens: parsed.data.output_tokens } : undefined;
}
