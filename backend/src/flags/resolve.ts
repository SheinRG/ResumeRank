import { createHash } from "node:crypto";

import { planGrants, type Plan } from "../billing/plans";
import { FEATURE_FLAGS, flagDefinition, isFeatureFlag, type FeatureFlag, type FlagDefinition } from "./registry";

export type FlagSource = "override" | "plan" | "rollout" | "default";

export interface FlagDecision {
  enabled: boolean;
  source: FlagSource;
}

export type FeatureSet = Record<FeatureFlag, boolean>;

export interface OverrideRow {
  flag: string;
  enabled: boolean;
}

/**
 * The company's place, 0–99, in a flag's rollout. Hashing the flag in too
 * means the same few tenants aren't first in line for every release, and a
 * company's place never moves, so raising the percentage only ever adds
 * companies.
 */
export function rolloutBucket(flag: FeatureFlag, companyId: string): number {
  const digest = createHash("sha256").update(`${flag}:${companyId}`).digest();
  return digest.readUInt32BE(0) % 100;
}

/**
 * Pure, so the order of precedence is unit-testable: a staff override, then
 * the plan (entitlements only, and only while billing is on, which is when
 * `plan` isn't null), then the rollout, then the default.
 */
export function decideFlag(
  flag: FeatureFlag,
  companyId: string,
  override: boolean | undefined,
  plan: Plan | null = null,
  definition: FlagDefinition = flagDefinition(flag),
): FlagDecision {
  if (override !== undefined) return { enabled: override, source: "override" };
  const { kind, rolloutPercent, defaultEnabled } = definition;
  if (kind === "entitlement" && plan !== null) return { enabled: planGrants(plan, flag), source: "plan" };
  if (rolloutPercent !== undefined && rolloutBucket(flag, companyId) < rolloutPercent) {
    return { enabled: true, source: "rollout" };
  }
  return { enabled: defaultEnabled, source: "default" };
}

export function overridesByFlag(rows: readonly OverrideRow[]): Map<FeatureFlag, boolean> {
  const overrides = new Map<FeatureFlag, boolean>();
  for (const row of rows) {
    if (isFeatureFlag(row.flag)) overrides.set(row.flag, row.enabled);
  }
  return overrides;
}

export function decideAll(
  companyId: string,
  rows: readonly OverrideRow[],
  plan: Plan | null,
): Record<FeatureFlag, FlagDecision> {
  const overrides = overridesByFlag(rows);
  return Object.fromEntries(
    FEATURE_FLAGS.map((flag) => [flag, decideFlag(flag, companyId, overrides.get(flag), plan)]),
  ) as Record<FeatureFlag, FlagDecision>;
}

export function featureSet(companyId: string, rows: readonly OverrideRow[], plan: Plan | null): FeatureSet {
  const decisions = decideAll(companyId, rows, plan);
  return Object.fromEntries(
    FEATURE_FLAGS.map((flag) => [flag, decisions[flag].enabled]),
  ) as FeatureSet;
}
