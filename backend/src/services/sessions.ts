import { tenantDb, tenantTransaction } from "../tenant-db";
import { logActivity } from "../activity";
import { revokeUserSessions } from "../auth/sessions";
import { sessionPolicyOf, type SessionPolicy } from "../auth/session-policy";
import type { SessionPolicyInput, SignOutMemberInput } from "../validators/session";
import { assertCanAdmin, type TenantContext } from "./context";
import { ForbiddenError, NotFoundError } from "./errors";
import { findTeammate, toTeamMember, type TeamMember } from "./team";

const POLICY_SELECT = { sessionLifetimeMinutes: true, sessionIdleMinutes: true } as const;

export async function getSessionPolicy(ctx: TenantContext): Promise<SessionPolicy> {
  const company = await tenantDb(ctx).company.findUnique({
    where: { id: ctx.companyId },
    select: POLICY_SELECT,
  });
  if (!company) throw new NotFoundError("Your company no longer exists.");
  return sessionPolicyOf(company);
}

/**
 * Applies to every session at once, existing ones included: the guards judge
 * each request against the current policy, so a shorter lifetime ends
 * sessions already older than it on their next request.
 */
export async function setSessionPolicy(ctx: TenantContext, input: SessionPolicyInput): Promise<SessionPolicy> {
  assertCanAdmin(ctx);
  if (ctx.role !== "OWNER") {
    throw new ForbiddenError("Only an owner can change how members sign in.");
  }

  return tenantTransaction(ctx, async (tx) => {
    const company = await tx.company.update({
      where: { id: ctx.companyId },
      data: { sessionLifetimeMinutes: input.lifetimeMinutes, sessionIdleMinutes: input.idleMinutes },
      select: POLICY_SELECT,
    });
    await logActivity(
      {
        companyId: ctx.companyId,
        actorId: ctx.actorId,
        action: "session.policy",
        entityType: "user",
        entityId: ctx.actorId,
        summary: "changed how long sessions last",
        metadata: { lifetimeMinutes: input.lifetimeMinutes, idleMinutes: input.idleMinutes },
      },
      tx,
    );
    return sessionPolicyOf(company);
  });
}

/**
 * Ends every session a teammate has, for a lost laptop or a suspected
 * compromise, including those open in other workspaces they belong to: a
 * stolen device is stolen everywhere, and signing back in is all it costs
 * them. Owners can only be signed out by an owner.
 */
export async function signOutMember(ctx: TenantContext, input: SignOutMemberInput): Promise<TeamMember> {
  assertCanAdmin(ctx);
  if (input.userId === ctx.actorId) {
    throw new ForbiddenError("Sign yourself out from Security settings.");
  }

  return tenantTransaction(ctx, async (tx) => {
    const target = await findTeammate(tx, ctx, input.userId);
    if (target.role === "OWNER" && ctx.role !== "OWNER") {
      throw new ForbiddenError("Only an owner can sign out another owner.");
    }

    // The RLS policy on LoginSession only exposes rows of this company's members.
    const revoked = await revokeUserSessions(tx, input.userId);
    await tx.user.update({ where: { id: input.userId }, data: { sessionVersion: { increment: 1 } } });
    const user = toTeamMember(target);
    await logActivity(
      {
        companyId: ctx.companyId,
        actorId: ctx.actorId,
        action: "user.sign_out",
        entityType: "user",
        entityId: user.id,
        summary: `signed ${user.name} out of every session`,
        metadata: { revoked },
      },
      tx,
    );
    return user;
  });
}
