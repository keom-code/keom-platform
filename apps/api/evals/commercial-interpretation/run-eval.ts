/**
 * Offline CommercialInterpreter comparison (OpenAI vs Jev) against human-labeled cases.
 *
 *   pnpm --filter @keom/api eval:interpreters -- [--providers openai,jev] [--tag negation]
 *                                               [--concurrency 2] [--include-drafts]
 *
 * Calls the interpreter classes directly — no Nest app, no Prisma, no HTTP — so nothing
 * is ever written to Opportunity tables (do NOT benchmark via /dev/interpretation/evaluate).
 * LLM_PROVIDER is ignored here: each requested provider runs with its own config
 * (OPENAI_API_KEY/OPENAI_MODEL/OPENAI_REASONING_EFFORT, TYPESAFE_API_KEY/JEV_MODEL,
 * LLM_TIMEOUT_MS), read from the shell environment. Results go to ./results/ (gitignored):
 * a JSON file with per-case predictions and raw Jev probabilities, and a Markdown summary.
 * The runner reports; it never picks a winner.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CommercialContext, DiagnosableCommercialInterpreter, InterpretationError, LlmProvider } from "../../src/llm/commercial-interpreter";
import { JevCommercialInterpreter } from "../../src/llm/jev-commercial-interpreter.service";
import { JEV_THRESHOLDS_VERSION } from "../../src/llm/jev-thresholds";
import { loadJevConfig, loadOpenAiConfig } from "../../src/llm/llm.config";
import { OpenAiCommercialInterpreter } from "../../src/llm/openai-commercial-interpreter.service";
import { EvalCase, loadDataset, toCommercialContext } from "./dataset";
import { CallStatus, CaseResult, ProviderSummary, summarize } from "./metrics";
import { renderMarkdownReport } from "./report";

const DATASET_PATH = join(__dirname, "dataset.v1.json");
const RESULTS_DIR = join(__dirname, "results");

interface RunOptions {
  providers: LlmProvider[];
  tag?: string;
  concurrency: number;
  includeDrafts: boolean;
}

function parseArgs(argv: string[]): RunOptions {
  const options: RunOptions = { providers: ["openai", "jev"], concurrency: 2, includeDrafts: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--providers") options.providers = (argv[++i] ?? "").split(",").map((p) => p.trim()) as LlmProvider[];
    else if (arg === "--tag") options.tag = argv[++i];
    else if (arg === "--concurrency") options.concurrency = Number(argv[++i]);
    else if (arg === "--include-drafts") options.includeDrafts = true;
    else if (arg !== "--") throw new Error(`Unknown argument "${arg}"`);
  }
  for (const provider of options.providers) {
    if (provider !== "openai" && provider !== "jev") throw new Error(`Unknown provider "${provider}"`);
  }
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) throw new Error("--concurrency must be a positive integer");
  return options;
}

function interpreterFor(provider: LlmProvider): DiagnosableCommercialInterpreter {
  return provider === "jev" ? new JevCommercialInterpreter() : new OpenAiCommercialInterpreter();
}

async function runCase(interpreter: DiagnosableCommercialInterpreter, evalCase: EvalCase, context: CommercialContext): Promise<CaseResult> {
  const startedAt = Date.now();
  try {
    const { interpretation, diagnostics } = await interpreter.interpretWithDiagnostics(context);
    return {
      caseId: evalCase.id,
      tags: evalCase.tags,
      status: "OK",
      prediction: interpretation,
      latencyMs: Date.now() - startedAt,
      model: diagnostics.model,
      usage: diagnostics.usage,
      raw: diagnostics.raw,
    };
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    if (err instanceof InterpretationError) {
      return {
        caseId: evalCase.id,
        tags: evalCase.tags,
        status: err.code as CallStatus,
        errorMessage: err.message,
        latencyMs,
        model: err.diagnostics?.model,
        usage: err.diagnostics?.usage,
        raw: err.diagnostics?.raw,
      };
    }
    return { caseId: evalCase.id, tags: evalCase.tags, status: "UNEXPECTED_ERROR", errorMessage: String(err), latencyMs };
  }
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const dataset = loadDataset(DATASET_PATH);

  const drafts = dataset.cases.filter((evalCase) => evalCase.review.status !== "reviewed");
  let cases = options.includeDrafts ? dataset.cases : dataset.cases.filter((evalCase) => evalCase.review.status === "reviewed");
  if (options.tag) cases = cases.filter((evalCase) => evalCase.tags.includes(options.tag as string));
  if (cases.length === 0) {
    throw new Error(
      `No cases to run (${drafts.length} of ${dataset.cases.length} are unreviewed drafts). Review labels first, or pass --include-drafts for a smoke run.`,
    );
  }

  const contexts = new Map(cases.map((evalCase) => [evalCase.id, toCommercialContext(evalCase)]));
  const summaries: ProviderSummary[] = [];
  const perCase: Record<string, CaseResult[]> = {};

  for (const provider of options.providers) {
    // Check config once up front instead of recording one MISSING_CONFIG per case.
    try {
      if (provider === "jev") loadJevConfig();
      else loadOpenAiConfig();
    } catch (err) {
      console.error(`[eval] skipping ${provider}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    console.log(`[eval] ${provider}: ${cases.length} cases, concurrency ${options.concurrency}`);
    const interpreter = interpreterFor(provider);
    const results = await mapWithConcurrency(cases, options.concurrency, (evalCase) =>
      runCase(interpreter, evalCase, contexts.get(evalCase.id) as CommercialContext),
    );
    perCase[provider] = results;
    summaries.push(summarize(provider, cases, results, contexts));
  }

  if (summaries.length === 0) throw new Error("No provider was configured; nothing was run.");

  const startedAt = new Date().toISOString();
  const meta = {
    runAt: startedAt,
    datasetVersion: dataset.version,
    casesRun: cases.length,
    unreviewedCasesIncluded: options.includeDrafts ? cases.filter((evalCase) => evalCase.review.status !== "reviewed").length : 0,
    tag: options.tag ?? null,
    jevThresholdsVersion: JEV_THRESHOLDS_VERSION,
    config: {
      openaiModel: process.env.OPENAI_MODEL || process.env.LLM_MODEL || null,
      openaiReasoningEffort: process.env.OPENAI_REASONING_EFFORT || null,
      jevModel: process.env.JEV_MODEL || null,
      timeoutMs: process.env.LLM_TIMEOUT_MS || "10000 (default)",
    },
  };

  mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = startedAt.replace(/[:.]/g, "-");
  const jsonPath = join(RESULTS_DIR, `${stamp}.json`);
  const mdPath = join(RESULTS_DIR, `${stamp}.md`);
  writeFileSync(jsonPath, JSON.stringify({ meta, summaries, perCase }, null, 2));
  writeFileSync(mdPath, renderMarkdownReport(meta, summaries));

  console.log(`[eval] wrote ${jsonPath}`);
  console.log(`[eval] wrote ${mdPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
