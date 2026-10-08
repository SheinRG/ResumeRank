import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { config } from "dotenv";

import { setTimeout as sleep } from "node:timers/promises";

import { classifyProviderFailure } from "../../src/ai/llm";
import { currentScoringSettings, requestEvaluation, type EvaluationOutcome } from "../../src/scoring/engine";
import { computeScore } from "../../src/scoring/math";
import { loadGoldenSet, type GoldenCase } from "./dataset";
import {
  computeMetrics,
  gate,
  verdictDrift,
  verdictsOf,
  type Baseline,
  type CaseRun,
  type EvalMetrics,
  type VerdictChange,
} from "./metrics";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

const BASELINE_PATH = fileURLToPath(new URL("./baseline.json", import.meta.url));
const REPORT_DIR = fileURLToPath(new URL("./reports/", import.meta.url));

const { values: args } = parseArgs({
  options: {
    repeats: { type: "string", default: "1" },
    concurrency: { type: "string", default: "1" },
    cases: { type: "string" },
    "write-baseline": { type: "boolean", default: false },
  },
});

const MAX_PROVIDER_RETRIES = 8;

/**
 * Free-tier rate limits are measured per minute, so a full pass routinely
 * hits them; wait as the provider asks (or back off), as the queue would.
 */
async function evaluateWithRetries(golden: GoldenCase): Promise<EvaluationOutcome> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await requestEvaluation(golden.job, golden.resume);
    } catch (error) {
      const failure = classifyProviderFailure(error);
      if (!failure.retryable || attempt > MAX_PROVIDER_RETRIES) throw error;
      const waitMs = Math.max(failure.retryAfterMs ?? 0, 5_000 * attempt);
      process.stderr.write(`${golden.id}: provider busy, retrying in ${Math.ceil(waitMs / 1000)}s
`);
      await sleep(waitMs);
    }
  }
}

async function runCase(golden: GoldenCase): Promise<CaseRun> {
  const outcome = await evaluateWithRetries(golden);
  const weightOf = new Map(golden.job.requirements.map((r) => [r.id, r.weight]));
  const judgments = outcome.result.evaluations.map((e) => {
    const label = golden.labels[e.requirementId];
    if (!label) throw new Error(`${golden.id}: model answered for unlabelled requirement ${e.requirementId}`);
    return {
      requirementId: e.requirementId,
      expected: label.verdict,
      actual: e.verdict,
      modelVerdict: e.modelVerdict,
      evidence: e.evidence,
      evidenceStatus: e.evidenceStatus,
      spans: label.evidence ?? [],
    };
  });
  const score = (pick: (j: (typeof judgments)[number]) => (typeof judgments)[number]["actual"]) =>
    computeScore(judgments.map((j) => ({ weight: weightOf.get(j.requirementId) ?? "NICE", verdict: pick(j) })));
  return {
    caseId: golden.id,
    model: outcome.model,
    expectInjection: golden.expectInjection ?? false,
    injectionSignals: outcome.injectionSignals,
    expectedScore: score((j) => j.expected),
    actualScore: score((j) => j.actual),
    judgments,
  };
}

/** A small pool: enough to finish quickly, few enough to stay under provider rate limits. */
async function runAll(cases: GoldenCase[], concurrency: number): Promise<CaseRun[]> {
  const results: CaseRun[] = new Array(cases.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < cases.length) {
      const index = next++;
      const golden = cases[index];
      if (golden) results[index] = await runCase(golden);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, cases.length) }, worker));
  return results;
}

const percent = (value: number | null) => (value === null ? "n/a" : `${(value * 100).toFixed(1)}%`);
const signed = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(3)}`;

function metricRows(metrics: EvalMetrics, baseline: EvalMetrics | null): string[] {
  const rows: Array<[string, string, string]> = [
    ["Verdict kappa", metrics.verdictKappa.toFixed(3), baseline ? signed(metrics.verdictKappa - baseline.verdictKappa) : ""],
    ["Verdict accuracy", percent(metrics.verdictAccuracy), baseline ? signed(metrics.verdictAccuracy - baseline.verdictAccuracy) : ""],
    ["Evidence precision", percent(metrics.evidencePrecision), ""],
    ["Evidence relevance", percent(metrics.evidenceRelevance), ""],
    ["STRONG evidence recall", percent(metrics.strongEvidenceRecall), ""],
    ["Score MAE", metrics.scoreMae.toFixed(1), baseline ? signed(metrics.scoreMae - baseline.scoreMae) : ""],
    ["Injection recall", percent(metrics.injectionRecall), ""],
    ["Injection false positives", String(metrics.injectionFalsePositives), ""],
    ["Stability across repeats", percent(metrics.stability), ""],
  ];
  return rows.map(([name, value, delta]) => `| ${name} | ${value} | ${delta} |`);
}

function renderReport(input: {
  metrics: EvalMetrics;
  baseline: Baseline | null;
  datasetVersion: number;
  model: string;
  promptVersion: string;
  repeats: number;
  drift: VerdictChange[];
  failures: string[];
}): string {
  const { metrics, baseline, drift, failures } = input;
  const comparable = baseline !== null && baseline.datasetVersion === input.datasetVersion;
  const lines = [
    "## Scoring eval",
    "",
    `Golden set v${input.datasetVersion}, ${metrics.judgments} judgments, ${input.repeats} pass(es) · model \`${input.model}\` · prompt \`${input.promptVersion}\``,
    baseline
      ? `Baseline: model \`${baseline.model}\`, prompt \`${baseline.promptVersion}\`${comparable ? "" : " (different golden set version — deltas not gated)"}`
      : "No baseline yet: run with `--write-baseline` to record one.",
    "",
    "| Metric | Value | vs baseline |",
    "| --- | --- | --- |",
    ...metricRows(metrics, comparable ? baseline.metrics : null),
    "",
    "Confusion (rows = label, columns = model after the evidence rule):",
    "",
    "| | STRONG | PARTIAL | MISSING |",
    "| --- | --- | --- | --- |",
    ...(["STRONG", "PARTIAL", "MISSING"] as const).map(
      (label) =>
        `| ${label} | ${metrics.confusion[label].STRONG} | ${metrics.confusion[label].PARTIAL} | ${metrics.confusion[label].MISSING} |`,
    ),
    "",
  ];
  if (drift.length > 0) {
    lines.push("Verdicts that changed since the baseline:", "");
    for (const change of drift) {
      const direction = change.after === change.expected ? "now matches the label" : "now disagrees with the label";
      lines.push(`- \`${change.key}\`: ${change.before} → ${change.after} (label ${change.expected}; ${direction})`);
    }
    lines.push("");
  }
  lines.push(failures.length === 0 ? "**Gate: passed.**" : "**Gate: failed.**");
  for (const failure of failures) lines.push(`- ${failure}`);
  return `${lines.join("\n")}\n`;
}

const golden = loadGoldenSet();
const only = args.cases ? new Set(args.cases.split(",")) : null;
const cases = only ? golden.cases.filter((c) => only.has(c.id)) : golden.cases;
const repeats = Math.max(1, Number(args.repeats));
const concurrency = Math.max(1, Number(args.concurrency));

const passes: CaseRun[][] = [];
for (let pass = 0; pass < repeats; pass++) passes.push(await runAll(cases, concurrency));
const firstPass = passes[0] ?? [];

const metrics = computeMetrics(passes);
const { promptVersion } = currentScoringSettings();
const baseline: Baseline | null = existsSync(BASELINE_PATH)
  ? (JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline)
  : null;
// A filtered run measures a subset, so it is never compared with or saved as the baseline.
const usable = only === null ? baseline : null;
const drift = usable ? verdictDrift(usable, firstPass) : [];
const failures = gate(metrics, usable, golden.version);
const model = [...new Set(passes.flat().map((run) => run.model))].join(", ");

const report = renderReport({
  metrics,
  baseline: usable,
  datasetVersion: golden.version,
  model,
  promptVersion,
  repeats,
  drift,
  failures,
});

mkdirSync(REPORT_DIR, { recursive: true });
writeFileSync(
  `${REPORT_DIR}latest.json`,
  `${JSON.stringify({ datasetVersion: golden.version, model, promptVersion, repeats, metrics, drift, failures, runs: passes }, null, 2)}\n`,
);
process.stdout.write(report);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);

if (args["write-baseline"]) {
  if (only !== null) throw new Error("A baseline must cover the whole golden set; drop --cases.");
  const next: Baseline = {
    datasetVersion: golden.version,
    model,
    promptVersion,
    metrics,
    verdicts: verdictsOf(firstPass),
  };
  writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`);
  process.stdout.write(`Baseline written to evals/scoring/baseline.json\n`);
} else if (failures.length > 0) {
  process.exitCode = 1;
}
