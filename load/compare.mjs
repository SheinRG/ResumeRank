// Compares a k6 run's summary (load/summary.json, written by handleSummary in
// resumerank.js) with the committed baseline, and fails on a regression:
//
//   node load/compare.mjs [summary.json] [--write-baseline]
//
// A path regresses when its p95 is more than TOLERANCE slower than the
// baseline (and more than SLACK_MS, so a 40ms → 55ms wobble isn't a failure),
// or when its error rate passes 1%. Refresh the baseline only for a change
// that is meant to move the numbers, and say why in the pull request.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TOLERANCE = 0.25;
const SLACK_MS = 50;
const MAX_ERROR_RATE = 0.01;
const BASELINE = fileURLToPath(new URL("./baseline.json", import.meta.url));

const args = process.argv.slice(2);
const writeBaseline = args.includes("--write-baseline");
const summaryPath = args.find((arg) => !arg.startsWith("--")) ?? fileURLToPath(new URL("./summary.json", import.meta.url));
const summary = JSON.parse(readFileSync(summaryPath, "utf8"));

if (writeBaseline) {
  writeFileSync(BASELINE, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`Baseline written to load/baseline.json from ${summaryPath}.`);
  process.exit(0);
}
// The first staging run has nothing to compare with: its summary (the
// workflow's artifact) becomes the baseline once committed.
if (!existsSync(BASELINE)) {
  console.log("No load/baseline.json yet: commit this run's summary as the baseline (--write-baseline).");
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
const rows = [];
let failed = false;
for (const [path, base] of Object.entries(baseline)) {
  const run = summary[path];
  if (!run || run.p95 === null) {
    rows.push([path, base.p95, "—", "", "FAIL: no data"]);
    failed = true;
    continue;
  }
  const limit = Math.max(base.p95 * (1 + TOLERANCE), base.p95 + SLACK_MS);
  const slow = run.p95 > limit;
  const errors = (run.errorRate ?? 0) > MAX_ERROR_RATE;
  const change = base.p95 ? `${Math.round(((run.p95 - base.p95) / base.p95) * 100)}%` : "";
  const verdict = slow ? `FAIL: p95 over ${Math.round(limit)}ms` : errors ? "FAIL: error rate" : "ok";
  if (slow || errors) failed = true;
  rows.push([path, base.p95, run.p95, change, verdict]);
}

console.log("path        baseline p95  run p95  change  verdict");
for (const [path, base, run, change, verdict] of rows) {
  console.log(
    `${String(path).padEnd(12)}${String(base).padStart(10)}ms ${`${run}${typeof run === "number" ? "ms" : ""}`.padStart(8)} ${String(change).padStart(7)}  ${verdict}`,
  );
}
process.exit(failed ? 1 : 0);
