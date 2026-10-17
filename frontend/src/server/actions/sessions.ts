"use server";

import { revalidatePath } from "next/cache";
import {
  requireAdmin,
  requireRecentAuth,
  requireUserSession,
  tenantContext,
  type UserSession,
} from "@/lib/auth/guards";
import type { SessionPolicy } from "@resumerank/core/auth/session-policy";
import {
  revokeLoginSession,
  revokeOtherLoginSessions,
  type SessionActor,
} from "@resumerank/core/auth/sessions";
import { setSessionPolicy, signOutMember } from "@resumerank/core/services/sessions";
import type { TeamMember } from "@resumerank/core/services/team";
import {
  loginSessionIdSchema,
  sessionPolicySchema,
  signOutMemberSchema,
} from "@resumerank/core/validators/session";
import { expireTenantReads } from "@/server/cache-tags";
import { runAction } from "@/server/run-action";
import { actionError, actionOk, type ActionResult } from "@resumerank/core/types/action";

const SECURITY_PATH = "/settings/security";

function sessionActor({ user, loginId }: UserSession): SessionActor {
  return { userId: user.id, companyId: user.companyId, loginId };
}

export async function revokeSessionAction(
  input: unknown,
): Promise<ActionResult<{ id: string; revokedAt: Date }>> {
  return runAction("revokeSession", async () => {
    const parsed = loginSessionIdSchema.safeParse(input);
    if (!parsed.success) return actionError("That session has already ended.");
    const session = await requireUserSession();
    const revoked = await revokeLoginSession(sessionActor(session), parsed.data.sessionId);
    revalidatePath(SECURITY_PATH);
    expireTenantReads(session.user.companyId);
    return actionOk(revoked);
  });
}

export async function revokeOtherSessionsAction(): Promise<ActionResult<{ revoked: number }>> {
  return runAction("revokeOtherSessions", async () => {
    const session = await requireUserSession();
    const result = await revokeOtherLoginSessions(sessionActor(session));
    revalidatePath(SECURITY_PATH);
    expireTenantReads(session.user.companyId);
    return actionOk(result);
  });
}

export async function setSessionPolicyAction(input: unknown): Promise<ActionResult<SessionPolicy>> {
  return runAction("setSessionPolicy", async () => {
    const parsed = sessionPolicySchema.safeParse(input);
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const admin = await requireAdmin();
    await requireRecentAuth();
    const policy = await setSessionPolicy(tenantContext(admin), parsed.data);
    revalidatePath(SECURITY_PATH);
    expireTenantReads(admin.companyId);
    return actionOk(policy);
  });
}

export async function signOutMemberAction(input: unknown): Promise<ActionResult<TeamMember>> {
  return runAction("signOutMember", async () => {
    const parsed = signOutMemberSchema.safeParse(input);
    if (!parsed.success) return actionError("That user no longer exists.");
    const admin = await requireAdmin();
    const member = await signOutMember(tenantContext(admin), parsed.data);
    revalidatePath("/settings/team");
    expireTenantReads(admin.companyId);
    return actionOk(member);
  });
}
