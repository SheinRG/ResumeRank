import { isBillingEnabled } from "../env";
import { tenantDb } from "../tenant-db";
import { BILLING_STATE_SELECT, billingPlan } from "../billing/account";
import type { Plan } from "../billing/plans";
import { flagDefinition, type FeatureFlag } from "../flags/registry";
import { decideFlag, featureSet, type FeatureSet } from "../flags/resolve";
import type { TenantContext } from "./context";
import { FeatureUnavailableError } from "./errors";

export type { FeatureSet } from "../flags/resolve";

/** Null while billing is off: then no plan gates anything. */
export async function getPlan(ctx: TenantContext): Promise<Plan | null> {
  const account = await tenantDb(ctx).billingAccount.findUnique({
    where: { companyId: ctx.companyId },
    select: BILLING_STATE_SELECT,
  });
  return billingPlan(account);
}

/** Every member may read them: pages use the set to show what the workspace has. */
export async function getFeatures(ctx: TenantContext): Promise<FeatureSet> {
  const [rows, plan] = await Promise.all([
    tenantDb(ctx).featureFlagOverride.findMany({
      where: { companyId: ctx.companyId },
      select: { flag: true, enabled: true },
    }),
    getPlan(ctx),
  ]);
  return featureSet(ctx.companyId, rows, plan);
}

export async function hasFeature(ctx: TenantContext, flag: FeatureFlag): Promise<boolean> {
  const [override, plan] = await Promise.all([
    tenantDb(ctx).featureFlagOverride.findFirst({
      where: { companyId: ctx.companyId, flag },
      select: { enabled: true },
    }),
    getPlan(ctx),
  ]);
  return decideFlag(flag, ctx.companyId, override?.enabled, plan).enabled;
}

export function featureUnavailableMessage(flag: FeatureFlag): string {
  const { label, kind } = flagDefinition(flag);
  return kind === "entitlement" && isBillingEnabled()
    ? `${label} isn't included in this workspace's plan. An owner can upgrade in Settings → Billing.`
    : `${label} isn't enabled for this workspace.`;
}

/**
 * Gates turning a feature on or using it, never turning it off: a workspace
 * that loses a feature can still disconnect what it set up.
 */
export async function assertFeature(ctx: TenantContext, flag: FeatureFlag): Promise<void> {
  if (!(await hasFeature(ctx, flag))) throw new FeatureUnavailableError(featureUnavailableMessage(flag));
}
