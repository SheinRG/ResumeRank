import { canAdmin, requireMember, tenantContext } from "@/lib/auth/guards";
import { getSupportAccess as readSupportAccess, type SupportAccess } from "@resumerank/core/services/support-access";

export type { SupportAccess, SupportSessionSummary } from "@resumerank/core/services/support-access";

/** Null for members who can't see workspace security settings. */
export async function getSupportAccess(): Promise<SupportAccess | null> {
  const user = await requireMember();
  if (!canAdmin(user.role)) return null;
  return readSupportAccess(tenantContext(user));
}
