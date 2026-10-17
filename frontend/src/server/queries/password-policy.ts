import { canAdmin, requireUser, tenantContext } from "@/lib/auth/guards";
import type { PasswordPolicy } from "@resumerank/core/auth/password-policy";
import * as policies from "@resumerank/core/services/password-policy";

export type { PasswordPolicy };

/** Null for members, who can't see the workspace policy, and for users without a workspace. */
export async function getPasswordPolicy(): Promise<PasswordPolicy | null> {
  const user = await requireUser();
  if (!user.companyId || !canAdmin(user.role)) return null;
  return policies.getPasswordPolicy(tenantContext({ ...user, companyId: user.companyId }));
}
