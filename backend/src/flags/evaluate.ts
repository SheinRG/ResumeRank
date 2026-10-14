import { db } from "../db";
import type { FeatureFlag } from "./registry";
import { decideFlag } from "./resolve";

/**
 * For work no member started (SCIM requests, the audit stream drain), which
 * has a company but no tenant context. Request paths use
 * `services/features` instead.
 */
export async function companyHasFeature(companyId: string, flag: FeatureFlag): Promise<boolean> {
  const override = await db.featureFlagOverride.findUnique({
    where: { companyId_flag: { companyId, flag } },
    select: { enabled: true },
  });
  return decideFlag(flag, companyId, override?.enabled).enabled;
}
