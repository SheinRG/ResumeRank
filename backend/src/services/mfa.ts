import { tenantDb, tenantTransaction } from "../tenant-db";
import { logActivity } from "../activity";
import type { ResetMemberMfaInput, SetMfaRequiredInput } from "../validators/mfa";
import { assertCanAdmin, type TenantContext } from "./context";
import { ConflictError, ForbiddenError, NotFoundError } from "./errors";
import { TEAM_MEMBER_SELECT, type TeamMember } from "./team";

export interface MfaPolicy {
  required: boolean;
  /** Members who would be sent to set up a second factor (SSO sign-ins aside). */
  membersWithoutMfa: number;
}

export async function getMfaPolicy(ctx: TenantContext): Promise<MfaPolicy> {
  const [company, membersWithoutMfa] = await Promise.all([
    tenantDb(ctx).company.findUnique({ where: { id: ctx.companyId }, select: { mfaRequired: true } }),
    tenantDb(ctx).user.count({ where: { companyId: ctx.companyId, mfaEnabledAt: null } }),
  ]);
  if (!company) throw new NotFoundError("Your company no longer exists.");
  return { required: company.mfaRequired, membersWithoutMfa };
}

/**
 * Members without a second factor are sent to set one up on their next
 * request. Owners included: unlike SSO enforcement there is no IdP outage to
 * keep a way around, and recovery codes plus an admin reset cover lockouts.
 * The owner turning it on must already use MFA, so the policy never starts
 * by locking out the person who set it.
 */
export async function setMfaRequired(ctx: TenantContext, input: SetMfaRequiredInput): Promise<MfaPolicy> {
  assertCanAdmin(ctx);
  if (ctx.role !== "OWNER") {
    throw new ForbiddenError("Only an owner can change how members sign in.");
  }

  return tenantTransaction(ctx, async (tx) => {
    if (input.required) {
      const actor = await tx.user.findFirst({
        where: { id: ctx.actorId, companyId: ctx.companyId },
        select: { mfaEnabledAt: true },
      });
      if (!actor?.mfaEnabledAt) {
        throw new ConflictError("Set up two-factor authentication for yourself before requiring it.");
      }
    }

    const company = await tx.company.update({
      where: { id: ctx.companyId },
      data: { mfaRequired: input.required },
      select: { mfaRequired: true },
    });
    const membersWithoutMfa = await tx.user.count({
      where: { companyId: ctx.companyId, mfaEnabledAt: null },
    });
    await logActivity(
      {
        companyId: ctx.companyId,
        actorId: ctx.actorId,
        action: "mfa.require",
        entityType: "user",
        entityId: ctx.actorId,
        summary: input.required
          ? "required two-factor authentication for members"
          : "stopped requiring two-factor authentication",
        metadata: { required: input.required, membersWithoutMfa },
      },
      tx,
    );
    return { required: company.mfaRequired, membersWithoutMfa };
  });
}

/**
 * For a teammate who lost every factor and their recovery codes. Their
 * sessions end too: whoever asked for the reset might not be them, and the
 * next sign-in (password plus a new factor if the company requires one) is
 * the check. Owners can only be reset by an owner.
 */
export async function resetMemberMfa(ctx: TenantContext, input: ResetMemberMfaInput): Promise<TeamMember> {
  assertCanAdmin(ctx);
  if (input.userId === ctx.actorId) {
    throw new ForbiddenError("Manage your own two-factor methods from Security settings.");
  }

  return tenantTransaction(ctx, async (tx) => {
    const target = await tx.user.findFirst({
      where: { id: input.userId, companyId: ctx.companyId },
      select: { role: true, mfaEnabledAt: true },
    });
    if (!target) throw new NotFoundError("That user no longer exists.");
    if (target.role === "OWNER" && ctx.role !== "OWNER") {
      throw new ForbiddenError("Only an owner can reset another owner's two-factor authentication.");
    }
    if (!target.mfaEnabledAt) {
      throw new ConflictError("That teammate doesn't have two-factor authentication set up.");
    }

    // The RLS policies on these tables only expose rows of this company's users.
    await tx.totpFactor.deleteMany({ where: { userId: input.userId } });
    await tx.webAuthnCredential.deleteMany({ where: { userId: input.userId } });
    await tx.webAuthnChallenge.deleteMany({ where: { userId: input.userId } });
    await tx.mfaRecoveryCode.deleteMany({ where: { userId: input.userId } });
    const user = await tx.user.update({
      where: { id: input.userId, companyId: ctx.companyId },
      data: { mfaEnabledAt: null, sessionVersion: { increment: 1 } },
      select: TEAM_MEMBER_SELECT,
    });
    await logActivity(
      {
        companyId: ctx.companyId,
        actorId: ctx.actorId,
        action: "mfa.reset",
        entityType: "user",
        entityId: user.id,
        summary: `reset ${user.name}'s two-factor authentication`,
      },
      tx,
    );
    return user;
  });
}
