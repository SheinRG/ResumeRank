// Fails on any high or critical advisory in production dependencies that is
// not explicitly accepted in .github/audit-allowlist.json. Every acceptance
// carries a reason and a review date, so an exception expires instead of
// silently living forever.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const BLOCKING = new Set(["high", "critical"]);

function runAudit() {
  try {
    return execFileSync("npm", ["audit", "--omit=dev", "--json"], { encoding: "utf8" });
  } catch (error) {
    // npm audit exits non-zero whenever it finds anything; the JSON is still on stdout.
    if (typeof error.stdout === "string" && error.stdout.trim()) return error.stdout;
    throw error;
  }
}

const report = JSON.parse(runAudit());
const allowlist = JSON.parse(readFileSync(new URL("../.github/audit-allowlist.json", import.meta.url), "utf8"));
const today = new Date().toISOString().slice(0, 10);
const accepted = new Map(allowlist.advisories.map((entry) => [entry.id, entry]));

const findings = new Map();
for (const [name, vuln] of Object.entries(report.vulnerabilities ?? {})) {
  for (const via of vuln.via) {
    if (typeof via !== "object" || !BLOCKING.has(via.severity)) continue;
    const id = via.url.split("/").pop();
    findings.set(id, { id, name, severity: via.severity, title: via.title, url: via.url });
  }
}

const blocking = [];
const expired = [];
for (const finding of findings.values()) {
  const entry = accepted.get(finding.id);
  if (!entry) blocking.push(finding);
  else if (entry.reviewBy < today) expired.push({ ...finding, reviewBy: entry.reviewBy });
}
const stale = allowlist.advisories.filter((entry) => !findings.has(entry.id));

for (const f of blocking) console.error(`BLOCKING ${f.severity} ${f.name} ${f.id}: ${f.title} (${f.url})`);
for (const f of expired) console.error(`EXPIRED ${f.name} ${f.id}: allowlisted until ${f.reviewBy}; re-review or fix it`);
for (const entry of stale) console.warn(`STALE allowlist entry ${entry.id} (${entry.package}) no longer applies; remove it`);

if (blocking.length || expired.length) process.exit(1);
console.log(`npm audit gate passed: ${findings.size} high/critical advisories, all accepted in the allowlist.`);
