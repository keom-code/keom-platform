import { CommercialContext, CommercialInterpretation, InterpretationUsage, LlmProvider } from "../../src/llm/commercial-interpreter";
import { OpportunityEngineService } from "../../src/opportunities/opportunity-engine.service";
import { SIGNAL_TYPES, SignalType } from "../../src/opportunities/opportunities.types";
import { EvalCase, evalNow } from "./dataset";

/**
 * Pure scoring for the offline provider comparison. Everything here is computed against
 * human labels (EvalCase.expected) — never against the other provider's output.
 */

export type CallStatus =
  | "OK"
  | "UNCERTAIN_OUTPUT"
  | "INVALID_OUTPUT"
  | "EMPTY_RESPONSE"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_ERROR"
  | "MISSING_CONFIG"
  | "INVALID_CONFIG"
  | "UNEXPECTED_ERROR";

export interface CaseResult {
  caseId: string;
  tags: string[];
  status: CallStatus;
  prediction?: CommercialInterpretation;
  errorMessage?: string;
  /** Wall-clock time around the interpreter call, retries included. */
  latencyMs: number;
  model?: string;
  usage?: InterpretationUsage;
  /** Provider-specific raw evidence (Jev per-question probabilities). */
  raw?: unknown;
}

/** What M2A would do with an interpretation, assuming no active Opportunity yet. */
export interface DownstreamOutcome {
  createsOpportunity: boolean;
  state?: string;
  priority?: string;
  risk?: string;
  nextBestAction?: string;
  score?: number;
  deactivate?: boolean;
}

const engine = new OpportunityEngineService();

/** Replays the real deterministic engine in memory (no DB), mirroring
 * OpportunitiesService's rule that zero signals + no active Opportunity is a no-op. */
export function m2aOutcome(
  interpretation: Pick<CommercialInterpretation, "interestLevel" | "signals">,
  context: CommercialContext,
): DownstreamOutcome {
  if (interpretation.signals.length === 0) return { createsOpportunity: false };

  const inbound = context.messages.filter((message) => message.direction === "INBOUND");
  const outbound = context.messages.filter((message) => message.direction === "OUTBOUND");
  const evaluation = engine.evaluate({
    interestLevel: interpretation.interestLevel,
    signals: interpretation.signals.map((type) => ({ type })),
    lastInboundAt: inbound[inbound.length - 1]?.sentAt,
    lastOutboundAt: outbound[outbound.length - 1]?.sentAt,
    now: evalNow(context),
  });
  return {
    createsOpportunity: true,
    state: evaluation.state,
    priority: evaluation.priority,
    risk: evaluation.risk,
    nextBestAction: evaluation.nextBestAction,
    score: evaluation.score,
    deactivate: evaluation.deactivate,
  };
}

export function downstreamDifferences(expected: DownstreamOutcome, predicted: DownstreamOutcome): string[] {
  const keys: (keyof DownstreamOutcome)[] = ["createsOpportunity", "deactivate", "state", "priority", "risk", "nextBestAction", "score"];
  return keys
    .filter((key) => expected[key] !== predicted[key])
    .map((key) => `${key}: expected ${String(expected[key])}, got ${String(predicted[key])}`);
}

export interface ModelPrice {
  inputPerMTokUsd: number;
  cachedInputPerMTokUsd?: number;
  outputPerMTokUsd: number;
  source: string;
  verifiedAt: string;
}

/** Published standard prices, checked against the official pages on the date shown.
 * Models not listed here get no cost estimate rather than a guessed one. Re-verify before
 * relying on a report. */
export const VERIFIED_PRICES: Record<string, ModelPrice> = {
  "gpt-5.6-luna": {
    inputPerMTokUsd: 0.2,
    cachedInputPerMTokUsd: 0.02,
    outputPerMTokUsd: 1.2,
    source: "https://developers.openai.com/api/docs/models/gpt-5.6-luna",
    verifiedAt: "2026-09-25",
  },
  "jev-1.13.0": {
    inputPerMTokUsd: 0.042,
    outputPerMTokUsd: 0,
    source: "https://docs.typesafe.ai/models",
    verifiedAt: "2026-09-25",
  },
};

/** Matches a served model id to a price entry; OpenAI may report a dated snapshot of the
 * requested alias (e.g. "gpt-5.6-luna-2026-..."). */
export function priceFor(model: string | undefined): ModelPrice | undefined {
  if (!model) return undefined;
  const key = Object.keys(VERIFIED_PRICES).find((name) => model === name || model.startsWith(`${name}-`));
  return key ? VERIFIED_PRICES[key] : undefined;
}

/** Cached input is billed at the cached rate; reasoning tokens are already included in
 * OpenAI's output token count, so they are not added again. */
export function estimateCostUsd(usage: InterpretationUsage, price: ModelPrice): number {
  const cached = usage.cachedInputTokens ?? 0;
  const uncached = usage.inputTokens - cached;
  const cachedRate = price.cachedInputPerMTokUsd ?? price.inputPerMTokUsd;
  return (uncached * price.inputPerMTokUsd + cached * cachedRate + usage.outputTokens * price.outputPerMTokUsd) / 1_000_000;
}

export interface SignalStats {
  tp: number;
  fp: number;
  fn: number;
  precision: number | null;
  recall: number | null;
  falsePositiveCases: string[];
  falseNegativeCases: string[];
}

export interface Accuracy {
  correct: number;
  answered: number;
  total: number;
  /** correct / answered — quality when the provider did answer. */
  answeredRate: number | null;
  /** correct / total — failures and abstentions count as wrong. */
  overallRate: number | null;
}

export interface CaseFailure {
  caseId: string;
  tags: string[];
  problems: string[];
}

export interface ProviderSummary {
  provider: LlmProvider;
  models: string[];
  cases: number;
  statusCounts: Partial<Record<CallStatus, number>>;
  intentAccuracy: Accuracy;
  interestLevelAccuracy: Accuracy;
  exactSignalSetMatch: Accuracy;
  perSignal: Record<SignalType, SignalStats>;
  falseNoLongerInterested: string[];
  missedNoLongerInterested: string[];
  downstreamMismatches: { caseId: string; differences: string[] }[];
  latencyMs: { n: number; p50: number | null; p95: number | null; max: number | null };
  usage: { calls: number; inputTokens: number; outputTokens: number; cachedInputTokens: number; reasoningTokens: number };
  estimatedCost: { totalUsd: number | null; perCallUsd: number | null; pricedCalls: number; unpricedCalls: number; basis: string };
  failures: CaseFailure[];
}

export function summarize(provider: LlmProvider, cases: EvalCase[], results: CaseResult[], contexts: Map<string, CommercialContext>): ProviderSummary {
  const byId = new Map(cases.map((evalCase) => [evalCase.id, evalCase]));
  const perSignal = Object.fromEntries(
    SIGNAL_TYPES.map((signal): [SignalType, SignalStats] => [
      signal,
      { tp: 0, fp: 0, fn: 0, precision: null, recall: null, falsePositiveCases: [], falseNegativeCases: [] },
    ]),
  ) as Record<SignalType, SignalStats>;

  const statusCounts: Partial<Record<CallStatus, number>> = {};
  let intentCorrect = 0;
  let interestCorrect = 0;
  let exactSignals = 0;
  let answered = 0;
  const falseNoLongerInterested: string[] = [];
  const missedNoLongerInterested: string[] = [];
  const downstreamMismatches: ProviderSummary["downstreamMismatches"] = [];
  const failures: CaseFailure[] = [];
  const models = new Set<string>();
  const usage = { calls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0 };
  let totalCost = 0;
  let pricedCalls = 0;
  let unpricedCalls = 0;

  for (const result of results) {
    const evalCase = byId.get(result.caseId);
    if (!evalCase) throw new Error(`Result for unknown case "${result.caseId}"`);
    statusCounts[result.status] = (statusCounts[result.status] ?? 0) + 1;
    if (result.model) models.add(result.model);

    if (result.usage) {
      usage.calls += 1;
      usage.inputTokens += result.usage.inputTokens;
      usage.outputTokens += result.usage.outputTokens;
      usage.cachedInputTokens += result.usage.cachedInputTokens ?? 0;
      usage.reasoningTokens += result.usage.reasoningTokens ?? 0;
      const price = priceFor(result.model);
      if (price) {
        totalCost += estimateCostUsd(result.usage, price);
        pricedCalls += 1;
      } else {
        unpricedCalls += 1;
      }
    }

    const problems: string[] = [];
    if (result.status !== "OK" || !result.prediction) {
      problems.push(`${result.status}${result.errorMessage ? `: ${result.errorMessage}` : ""}`);
      failures.push({ caseId: evalCase.id, tags: evalCase.tags, problems });
      continue;
    }

    answered += 1;
    const prediction = result.prediction;
    const acceptableIntents = evalCase.acceptableIntents ?? [evalCase.expected.intent];
    const acceptableInterest = evalCase.acceptableInterestLevels ?? [evalCase.expected.interestLevel];

    if (acceptableIntents.includes(prediction.intent)) intentCorrect += 1;
    else problems.push(`intent: expected ${acceptableIntents.join("|")}, got ${prediction.intent}`);

    if (acceptableInterest.includes(prediction.interestLevel)) interestCorrect += 1;
    else problems.push(`interestLevel: expected ${acceptableInterest.join("|")}, got ${prediction.interestLevel}`);

    const expectedSignals = new Set(evalCase.expected.signals);
    const predictedSignals = new Set(prediction.signals);
    let signalsExact = true;
    for (const signal of SIGNAL_TYPES) {
      const expected = expectedSignals.has(signal);
      const predicted = predictedSignals.has(signal);
      const stats = perSignal[signal];
      if (expected && predicted) stats.tp += 1;
      if (!expected && predicted) {
        stats.fp += 1;
        stats.falsePositiveCases.push(evalCase.id);
        problems.push(`false positive ${signal}`);
        signalsExact = false;
      }
      if (expected && !predicted) {
        stats.fn += 1;
        stats.falseNegativeCases.push(evalCase.id);
        problems.push(`false negative ${signal}`);
        signalsExact = false;
      }
    }
    if (signalsExact) exactSignals += 1;
    if (predictedSignals.has("NO_LONGER_INTERESTED") && !expectedSignals.has("NO_LONGER_INTERESTED")) falseNoLongerInterested.push(evalCase.id);
    if (!predictedSignals.has("NO_LONGER_INTERESTED") && expectedSignals.has("NO_LONGER_INTERESTED")) missedNoLongerInterested.push(evalCase.id);

    const context = contexts.get(evalCase.id);
    if (context) {
      const differences = downstreamDifferences(m2aOutcome(evalCase.expected, context), m2aOutcome(prediction, context));
      if (differences.length > 0) {
        downstreamMismatches.push({ caseId: evalCase.id, differences });
        problems.push(...differences.map((difference) => `M2A ${difference}`));
      }
    }

    if (problems.length > 0) failures.push({ caseId: evalCase.id, tags: evalCase.tags, problems });
  }

  for (const stats of Object.values(perSignal)) {
    stats.precision = ratio(stats.tp, stats.tp + stats.fp);
    stats.recall = ratio(stats.tp, stats.tp + stats.fn);
  }

  // Config errors never reach the provider, so they say nothing about its latency.
  const latencies = results
    .filter((result) => result.status !== "MISSING_CONFIG" && result.status !== "INVALID_CONFIG")
    .map((result) => result.latencyMs)
    .sort((a, b) => a - b);

  return {
    provider,
    models: [...models],
    cases: results.length,
    statusCounts,
    intentAccuracy: accuracy(intentCorrect, answered, results.length),
    interestLevelAccuracy: accuracy(interestCorrect, answered, results.length),
    exactSignalSetMatch: accuracy(exactSignals, answered, results.length),
    perSignal,
    falseNoLongerInterested,
    missedNoLongerInterested,
    downstreamMismatches,
    latencyMs: { n: latencies.length, p50: percentile(latencies, 50), p95: percentile(latencies, 95), max: latencies[latencies.length - 1] ?? null },
    usage,
    estimatedCost: {
      totalUsd: pricedCalls > 0 ? totalCost : null,
      perCallUsd: pricedCalls > 0 ? totalCost / pricedCalls : null,
      pricedCalls,
      unpricedCalls,
      basis:
        "ESTIMATED: provider-reported token usage × published list price (see VERIFIED_PRICES). Neither provider returns a billed amount per request; calls without usage (e.g. timeouts) are not counted.",
    },
    failures,
  };
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function accuracy(correct: number, answered: number, total: number): Accuracy {
  return { correct, answered, total, answeredRate: ratio(correct, answered), overallRate: ratio(correct, total) };
}

/** Nearest-rank percentile over an ascending-sorted array. */
export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1] ?? null;
}
