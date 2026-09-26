import { CommercialInterpretation } from "../../src/llm/commercial-interpreter";
import { EvalCase, loadDataset, toCommercialContext } from "./dataset";
import { CaseResult, estimateCostUsd, m2aOutcome, percentile, priceFor, summarize, VERIFIED_PRICES } from "./metrics";
import { renderMarkdownReport } from "./report";

function evalCase(id: string, expected: EvalCase["expected"], extra: Partial<EvalCase> = {}): EvalCase {
  return {
    id,
    tags: [],
    messages: [{ direction: "INBOUND", text: "hola" }],
    expected,
    review: { status: "reviewed", reviewer: "test", reviewedAt: "2026-09-26" },
    ...extra,
  };
}

function ok(caseId: string, prediction: Partial<CommercialInterpretation>, latencyMs = 100): CaseResult {
  return {
    caseId,
    tags: [],
    status: "OK",
    latencyMs,
    model: "jev-1.13.0",
    usage: { inputTokens: 1_000_000, outputTokens: 10 },
    prediction: { intent: "OTHER", interestLevel: "LOW", signals: [], entities: {}, confidence: 0.9, ...prediction },
  };
}

const cases: EvalCase[] = [
  evalCase("price", { intent: "PRICING", interestLevel: "MEDIUM", signals: ["PRICING_REQUESTED"] }),
  evalCase("lost", { intent: "OTHER", interestLevel: "LOW", signals: ["NO_LONGER_INTERESTED"] }),
  evalCase("negation", { intent: "BOOKING", interestLevel: "HIGH", signals: ["BOOKING_INTENT"] }, { acceptableIntents: ["BOOKING", "OTHER"] }),
  evalCase("greeting", { intent: "OTHER", interestLevel: "LOW", signals: [] }),
];
const contexts = new Map(cases.map((c) => [c.id, toCommercialContext(c)]));

describe("offline evaluation metrics", () => {
  const results: CaseResult[] = [
    ok("price", { intent: "PRICING", interestLevel: "MEDIUM", signals: ["PRICING_REQUESTED", "AVAILABILITY_REQUESTED"] }, 100),
    ok("lost", { signals: [] }, 200),
    ok("negation", { intent: "OTHER", interestLevel: "HIGH", signals: ["BOOKING_INTENT", "NO_LONGER_INTERESTED"] }, 300),
    { caseId: "greeting", tags: [], status: "UNCERTAIN_OUTPUT", errorMessage: "OBJECTION(p=0.5)", latencyMs: 400 },
  ];
  const summary = summarize("jev", cases, results, contexts);

  it("scores intent against acceptableIntents and separates answered vs overall accuracy", () => {
    expect(summary.intentAccuracy).toMatchObject({ correct: 3, answered: 3, total: 4 });
    expect(summary.intentAccuracy.overallRate).toBeCloseTo(0.75);
  });

  it("computes per-signal TP/FP/FN, precision and recall with the offending case ids", () => {
    expect(summary.perSignal.PRICING_REQUESTED).toMatchObject({ tp: 1, fp: 0, fn: 0, precision: 1, recall: 1 });
    expect(summary.perSignal.AVAILABILITY_REQUESTED).toMatchObject({ tp: 0, fp: 1, falsePositiveCases: ["price"], precision: 0, recall: null });
    expect(summary.perSignal.NO_LONGER_INTERESTED).toMatchObject({ tp: 0, fp: 1, fn: 1 });
  });

  it("lists false and missed NO_LONGER_INTERESTED cases explicitly", () => {
    expect(summary.falseNoLongerInterested).toEqual(["negation"]);
    expect(summary.missedNoLongerInterested).toEqual(["lost"]);
  });

  it("counts an uncertain answer as a failure, never as a correct empty-signal prediction", () => {
    expect(summary.statusCounts).toEqual({ OK: 3, UNCERTAIN_OUTPUT: 1 });
    expect(summary.exactSignalSetMatch.correct).toBe(0);
    expect(summary.failures.find((f) => f.caseId === "greeting")?.problems[0]).toContain("UNCERTAIN_OUTPUT");
  });

  it("reports M2A outcome differences from replaying the real engine", () => {
    const negation = summary.downstreamMismatches.find((m) => m.caseId === "negation");
    expect(negation?.differences).toEqual(expect.arrayContaining([expect.stringContaining("deactivate: expected false, got true")]));
    const lost = summary.downstreamMismatches.find((m) => m.caseId === "lost");
    expect(lost?.differences).toEqual(expect.arrayContaining([expect.stringContaining("createsOpportunity: expected true, got false")]));
  });

  it("estimates cost only from verified prices and labels it as an estimate", () => {
    expect(summary.estimatedCost.pricedCalls).toBe(3);
    expect(summary.estimatedCost.totalUsd).toBeCloseTo(3 * 0.042);
    expect(summary.estimatedCost.basis).toMatch(/^ESTIMATED/);
  });

  it("includes failed calls in latency percentiles", () => {
    expect(summary.latencyMs).toEqual({ n: 4, p50: 200, p95: 400, max: 400 });
  });

  it("renders a Markdown report that shows failure cases and no winner", () => {
    const md = renderMarkdownReport(
      { runAt: "t", datasetVersion: "v1", casesRun: 4, unreviewedCasesIncluded: 0, tag: null, jevThresholdsVersion: "x", config: {} },
      [summary],
    );
    expect(md).toContain("**negation**");
    expect(md).toContain("ESTIMATED");
    expect(md.toLowerCase()).not.toContain("winner:");
  });
});

describe("pricing helpers", () => {
  it("matches dated OpenAI snapshots to the alias price and leaves unknown models unpriced", () => {
    expect(priceFor("gpt-5.6-luna-2026-08-01")).toBe(VERIFIED_PRICES["gpt-5.6-luna"]);
    expect(priceFor("gpt-4o-mini")).toBeUndefined();
  });

  it("bills cached input at the cached rate and does not double-count reasoning tokens", () => {
    const price = VERIFIED_PRICES["gpt-5.6-luna"]!;
    const cost = estimateCostUsd({ inputTokens: 1000, cachedInputTokens: 400, outputTokens: 200, reasoningTokens: 150 }, price);
    expect(cost).toBeCloseTo((600 * 0.2 + 400 * 0.02 + 200 * 1.2) / 1_000_000);
  });

  it("computes nearest-rank percentiles", () => {
    expect(percentile([10, 20, 30, 40], 50)).toBe(20);
    expect(percentile([], 95)).toBeNull();
  });
});

describe("m2aOutcome", () => {
  it("mirrors OpportunitiesService: no signals means no Opportunity is created", () => {
    expect(m2aOutcome({ interestLevel: "LOW", signals: [] }, toCommercialContext(cases[3]!))).toEqual({ createsOpportunity: false });
  });
});

describe("dataset.v1.json", () => {
  const dataset = loadDataset(`${__dirname}/dataset.v1.json`);

  it("loads with valid labels and unique ids", () => {
    expect(dataset.cases).toHaveLength(50);
  });

  it("stays within the production context bound of 10 messages per case", () => {
    for (const c of dataset.cases) expect(toCommercialContext(c).messages.length).toBeLessThanOrEqual(10);
  });
});
