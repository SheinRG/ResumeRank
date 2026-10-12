import { canAdmin, requireUser, requireUserSession, tenantContext } from "@/lib/auth/guards";
import * as sessions from "@resumerank/core/auth/sessions";
import * as policies from "@resumerank/core/services/sessions";
import type { SessionPolicy } from "@resumerank/core/auth/session-policy";

export type { LoginSessionSummary } from "@resumerank/core/auth/sessions";
export type { SessionPolicy } from "@resumerank/core/auth/session-policy";

export async function getLoginSessions(): Promise<sessions.LoginSessionSummary[]> {
  const { user, loginId } = await requireUserSession();
  return sessions.listLoginSessions(user.id, loginId);
}

/** Null for members who can't see the workspace policy, and for users without a workspace. */
export async function getSessionPolicy(): Promise<SessionPolicy | null> {
  const user = await requireUser();
  if (!user.companyId || !canAdmin(user.role)) return null;
  return policies.getSessionPolicy(tenantContext({ ...user, companyId: user.companyId }));
}
