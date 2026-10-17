import { db } from "../db";
import { BILLING_STATE_SELECT, billingPlan } from "../billing/account";
import type { FeatureFlag } from "./registry";
import { decideFlag } from "./resolve";

/**
 * For work no member started (SCIM requests, the audit stream drain), which
 * has a company but no tenant context. Request paths use
 * `services/features` instead.
 */
export async function companyHasFeature(companyId: string, flag: FeatureFlag): Promise<boolean> {
  const [override, account] = await Promise.all([
    db.featureFlagOverride.findUnique({
      where: { companyId_flag: { companyId, flag } },
      select: { enabled: true },
    }),
    db.billingAccount.findUnique({ where: { companyId }, select: BILLING_STATE_SELECT }),
  ]);
  return decideFlag(flag, companyId, override?.enabled, billingPlan(account)).enabled;
}
