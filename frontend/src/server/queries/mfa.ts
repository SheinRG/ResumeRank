import { canAdmin, requireUser, tenantContext } from "@/lib/auth/guards";
import * as factors from "@resumerank/core/auth/mfa/factors";
import * as mfa from "@resumerank/core/services/mfa";

export type { MfaMethods, MfaStatus, PasskeySummary } from "@resumerank/core/auth/mfa/factors";
export type { MfaPolicy } from "@resumerank/core/services/mfa";

export async function getMfaStatus(): Promise<factors.MfaStatus> {
  const user = await requireUser();
  return factors.getMfaStatus(user.id);
}

/** Null for members who can't see the workspace policy, and for users without a workspace. */
export async function getMfaPolicy(): Promise<mfa.MfaPolicy | null> {
  const user = await requireUser();
  if (!user.companyId || !canAdmin(user.role)) return null;
  return mfa.getMfaPolicy(tenantContext({ ...user, companyId: user.companyId }));
}
