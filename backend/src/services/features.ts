import { tenantDb } from "../tenant-db";
import { flagDefinition, type FeatureFlag } from "../flags/registry";
import { decideFlag, featureSet, type FeatureSet } from "../flags/resolve";
import type { TenantContext } from "./context";
import { FeatureUnavailableError } from "./errors";

export type { FeatureSet } from "../flags/resolve";

/** Every member may read them: pages use the set to show what the workspace has. */
export async function getFeatures(ctx: TenantContext): Promise<FeatureSet> {
  const rows = await tenantDb(ctx).featureFlagOverride.findMany({
    where: { companyId: ctx.companyId },
    select: { flag: true, enabled: true },
  });
  return featureSet(ctx.companyId, rows);
}

export async function hasFeature(ctx: TenantContext, flag: FeatureFlag): Promise<boolean> {
  const override = await tenantDb(ctx).featureFlagOverride.findFirst({
    where: { companyId: ctx.companyId, flag },
    select: { enabled: true },
  });
  return decideFlag(flag, ctx.companyId, override?.enabled).enabled;
}

export function featureUnavailableMessage(flag: FeatureFlag): string {
  return `${flagDefinition(flag).label} isn't enabled for this workspace.`;
}

/**
 * Gates turning a feature on or using it, never turning it off: a workspace
 * that loses a feature can still disconnect what it set up.
 */
export async function assertFeature(ctx: TenantContext, flag: FeatureFlag): Promise<void> {
  if (!(await hasFeature(ctx, flag))) throw new FeatureUnavailableError(featureUnavailableMessage(flag));
}
