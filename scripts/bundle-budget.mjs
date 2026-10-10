// Gzipped first-load JavaScript per App Router route, checked against
// frontend/bundle-budget.json. Turbopack builds don't print route sizes, so
// this reads the client reference manifests the build writes for each page:
// a route loads the framework's root chunks plus its entries' chunks.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { runInNewContext } from "node:vm";
import { gzipSync } from "node:zlib";

const frontend = new URL("../frontend/", import.meta.url).pathname;
const nextDir = join(frontend, ".next");
const budget = JSON.parse(readFileSync(join(frontend, "bundle-budget.json"), "utf8"));
const report = process.argv.includes("--report");

const gzipped = new Map();
function size(file) {
  if (!gzipped.has(file)) gzipped.set(file, gzipSync(readFileSync(join(nextDir, file))).length);
  return gzipped.get(file);
}

const buildManifest = JSON.parse(readFileSync(join(nextDir, "build-manifest.json"), "utf8"));
const rootFiles = [...(buildManifest.rootMainFiles ?? []), ...(buildManifest.polyfillFiles ?? [])];

function* manifests(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* manifests(path);
    else if (entry === "page_client-reference-manifest.js") yield path;
  }
}

const rows = [];
for (const file of manifests(join(nextDir, "server", "app"))) {
  const sandbox = { globalThis: {} };
  runInNewContext(readFileSync(file, "utf8"), sandbox);
  for (const [route, manifest] of Object.entries(sandbox.globalThis.__RSC_MANIFEST)) {
    const chunks = new Set(rootFiles);
    for (const files of Object.values(manifest.entryJSFiles ?? {})) {
      for (const chunk of files) chunks.add(chunk);
    }
    const kb = [...chunks].reduce((sum, chunk) => sum + size(chunk), 0) / 1024;
    const limit = budget.routes[route] ?? budget.defaultKB;
    rows.push({ route, kb, limit, over: kb > limit, source: relative(nextDir, file) });
  }
}

rows.sort((a, b) => b.kb - a.kb);
for (const row of rows) {
  if (report || row.over) {
    const flag = row.over ? "OVER " : "     ";
    console.log(`${flag}${row.kb.toFixed(1).padStart(7)} KB / ${String(row.limit).padStart(4)} KB  ${row.route}`);
  }
}
const over = rows.filter((row) => row.over);
if (over.length) {
  console.error(`${over.length} route(s) over their first-load JS budget (gzipped). Shrink them or, if the growth is intended, raise the budget in frontend/bundle-budget.json.`);
  process.exit(1);
}
console.log(`Bundle budget passed for ${rows.length} routes (largest ${rows[0]?.kb.toFixed(1)} KB gzipped).`);
