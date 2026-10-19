import { userInfo } from "node:os";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { config } from "dotenv";

// Variables already set win, so DATABASE_URL=... points it at another database.
config({ path: fileURLToPath(new URL("../../.env", import.meta.url)), quiet: true });

// Imported only after the environment is loaded: `db` connects at import.
const { db } = await import("../src/db");
const { FEATURE_FLAGS, flagDefinition } = await import("../src/flags/registry");
const { describeCompanyFlags, setFlagOverride } = await import("../src/flags/overrides");
const { DomainError } = await import("../src/services/errors");
const { flagOverrideSchema } = await import("../src/validators/feature-flag");

const USAGE = `Usage: npm run flags -- <command>

  list                                   every flag, its kind, default and rollout
  show <company-slug>                    what a company gets, and why
  set <company-slug> <flag> on|off [--reason "..."]
  clear <company-slug> <flag>            drop the override; rollout and default apply again
`;

function write(line = ""): void {
  process.stdout.write(`${line}\n`);
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function list(): void {
  for (const flag of FEATURE_FLAGS) {
    const definition = flagDefinition(flag);
    const rollout = definition.rolloutPercent === undefined ? "" : `, rollout ${definition.rolloutPercent}%`;
    write(`${flag}  [${definition.kind}] default ${definition.defaultEnabled ? "on" : "off"}${rollout}`);
    write(`    ${definition.description}`);
  }
}

async function show(slug: string): Promise<void> {
  const report = await describeCompanyFlags(slug);
  write(`${report.company.name} (${report.company.slug}, ${report.company.id})`);
  write(`  plan: ${report.plan ?? "none (billing is off)"}`);
  for (const { flag, decision, reason } of report.flags) {
    const why = reason ? ` — ${reason}` : "";
    write(`  ${flag}: ${decision.enabled ? "on" : "off"} (${decision.source}${why})`);
  }
}

async function change(slug: string | undefined, flag: string | undefined, enabled: boolean | null, reason?: string) {
  const parsed = flagOverrideSchema.safeParse({ companySlug: slug, flag, enabled, reason });
  if (!parsed.success) fail(parsed.error.issues.map((issue) => issue.message).join("\n"));
  const result = await setFlagOverride(parsed.data, { userId: null, email: `cli:${userInfo().username}` });
  const state = result.decision.enabled ? "on" : "off";
  write(
    result.changed
      ? `${result.flag} is now ${state} for ${result.company.name} (${result.decision.source}).`
      : `Nothing changed: ${result.flag} is already ${state} for ${result.company.name} (${result.decision.source}).`,
  );
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { reason: { type: "string" } },
});
const [command, slug, flag, state] = positionals;

try {
  switch (command) {
    case "list":
      list();
      break;
    case "show":
      if (!slug) fail(USAGE);
      await show(slug);
      break;
    case "set":
      if (state !== "on" && state !== "off") fail(USAGE);
      await change(slug, flag, state === "on", values.reason);
      break;
    case "clear":
      await change(slug, flag, null);
      break;
    default:
      fail(USAGE);
  }
} catch (error) {
  if (error instanceof DomainError) fail(error.message);
  throw error;
} finally {
  await db.$disconnect();
}
