import { SIGNAL_TYPES } from "../../src/opportunities/opportunities.types";
import { Accuracy, ProviderSummary } from "./metrics";

export interface ReportMeta {
  runAt: string;
  datasetVersion: string;
  casesRun: number;
  unreviewedCasesIncluded: number;
  tag: string | null;
  jevThresholdsVersion: string;
  config: Record<string, string | null>;
}

const pct = (value: number | null) => (value === null ? "n/a" : `${(value * 100).toFixed(1)}%`);
const acc = (a: Accuracy) => `${a.correct}/${a.answered} answered (${pct(a.answeredRate)}) · ${a.correct}/${a.total} overall (${pct(a.overallRate)})`;
const usd = (value: number | null) => (value === null ? "n/a (no verified price for this model)" : `$${value.toFixed(6)}`);

/** Human-readable summary. Deliberately has no "winner" section — see apps/api/README.md. */
export function renderMarkdownReport(meta: ReportMeta, summaries: ProviderSummary[]): string {
  const lines: string[] = [];
  lines.push(`# CommercialInterpreter offline evaluation — ${meta.runAt}`, "");
  lines.push(`- Dataset: ${meta.datasetVersion}, ${meta.casesRun} cases${meta.tag ? `, tag "${meta.tag}"` : ""}`);
  if (meta.unreviewedCasesIncluded > 0) {
    lines.push(`- **WARNING: ${meta.unreviewedCasesIncluded} cases have unreviewed draft labels — smoke run only, not a quality result.**`);
  }
  lines.push(`- Jev thresholds: ${meta.jevThresholdsVersion}`);
  lines.push(`- Config: ${Object.entries(meta.config).map(([key, value]) => `${key}=${value ?? "unset"}`).join(", ")}`);
  lines.push(`- n=${meta.casesRun} is small: treat differences of a few cases as noise, not evidence.`, "");

  for (const s of summaries) {
    lines.push(`## ${s.provider} (${s.models.join(", ") || "no model reported"})`, "");
    lines.push(`- Status: ${Object.entries(s.statusCounts).map(([status, count]) => `${status}=${count}`).join(", ")}`);
    lines.push(`- Intent accuracy: ${acc(s.intentAccuracy)}`);
    lines.push(`- Interest-level accuracy: ${acc(s.interestLevelAccuracy)}`);
    lines.push(`- Exact signal-set match: ${acc(s.exactSignalSetMatch)}`);
    lines.push(`- False NO_LONGER_INTERESTED: ${s.falseNoLongerInterested.length} ${list(s.falseNoLongerInterested)}`);
    lines.push(`- Missed NO_LONGER_INTERESTED: ${s.missedNoLongerInterested.length} ${list(s.missedNoLongerInterested)}`);
    lines.push(`- M2A outcome differences: ${s.downstreamMismatches.length} ${list(s.downstreamMismatches.map((m) => m.caseId))}`);
    lines.push(`- Latency (wall clock, retries included): p50=${s.latencyMs.p50 ?? "n/a"}ms p95=${s.latencyMs.p95 ?? "n/a"}ms max=${s.latencyMs.max ?? "n/a"}ms (n=${s.latencyMs.n})`);
    lines.push(
      `- Usage (provider-reported, ${s.usage.calls} calls): input=${s.usage.inputTokens} (cached ${s.usage.cachedInputTokens}), output=${s.usage.outputTokens} (reasoning ${s.usage.reasoningTokens})`,
    );
    lines.push(
      `- Cost, ESTIMATED (not measured): total ${usd(s.estimatedCost.totalUsd)}, per call ${usd(s.estimatedCost.perCallUsd)} — ${s.estimatedCost.pricedCalls} priced / ${s.estimatedCost.unpricedCalls} unpriced calls`,
      "",
    );

    lines.push("| Signal | TP | FP | FN | Precision | Recall |", "|---|---|---|---|---|---|");
    for (const signal of SIGNAL_TYPES) {
      const st = s.perSignal[signal];
      lines.push(`| ${signal} | ${st.tp} | ${st.fp} | ${st.fn} | ${pct(st.precision)} | ${pct(st.recall)} |`);
    }
    lines.push("");

    lines.push(`### Failure cases (${s.failures.length})`, "");
    if (s.failures.length === 0) lines.push("None.");
    for (const failure of s.failures) {
      lines.push(`- **${failure.caseId}** [${failure.tags.join(", ")}]: ${failure.problems.join("; ")}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function list(ids: string[]): string {
  return ids.length > 0 ? `(${ids.join(", ")})` : "";
}
