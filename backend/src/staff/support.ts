import { db } from "../db";
import { logActivity } from "../activity";
import { revokeUserSessions } from "../auth/sessions";
import { setFlagOverride, type FlagOverrideChange } from "../flags/overrides";
import { NotFoundError } from "../services/errors";
import type { LiftSuppressionInput, StaffFlagOverrideInput, StaffMemberActionInput } from "../validators/staff";
import { assertStaffRole, auditorOf, logStaffAction, type StaffActor } from "./actor";
import { staffCompanyMember } from "./companies";

/** The console's way to `npm run flags -- set`, for staff admins. */
export async function setCompanyFlag(actor: StaffActor, input: StaffFlagOverrideInput): Promise<FlagOverrideChange> {
  assertStaffRole(actor, "ADMIN");
  const company = await db.company.findUnique({ where: { id: input.companyId }, select: { slug: true } });
  if (!company) throw new NotFoundError("No workspace has that id.");
  return setFlagOverride(
    { companySlug: company.slug, flag: input.flag, enabled: input.enabled, reason: input.reason },
    auditorOf(actor),
  );
}

/**
 * Lets mail reach an address again after a bounce or complaint, for when the
 * mailbox has been fixed. Limited to the workspace's members and invitees,
 * so a ticket about one workspace can't unblock arbitrary addresses.
 */
export async function liftSuppression(actor: StaffActor, input: LiftSuppressionInput): Promise<{ lifted: boolean }> {
  assertStaffRole(actor, "SUPPORT");
  const [member, invite] = await Promise.all([
    db.membership.findFirst({ where: { companyId: input.companyId, user: { email: input.email } }, select: { id: true } }),
    db.companyInvite.findFirst({ where: { companyId: input.companyId, email: input.email }, select: { id: true } }),
  ]);
  if (!member && !invite) throw new NotFoundError("That address isn't a member or invitee of this workspace.");

  return db.$transaction(async (tx) => {
    const { count } = await tx.emailSuppression.deleteMany({ where: { email: input.email } });
    if (count > 0) {
      await logStaffAction(
        auditorOf(actor),
        {
          action: "staff.lift_suppression",
          summary: `let email reach ${input.email} again`,
          companyId: input.companyId,
          metadata: { email: input.email, reason: input.reason },
        },
        tx,
      );
    }
    return { lifted: count > 0 };
  });
}

/**
 * Ends every session of a member's account, for a lost device or a
 * suspected takeover reported to support. The account spans workspaces, so
 * each of them records it, as it would an admin signing someone out.
 */
export async function signOutMember(actor: StaffActor, input: StaffMemberActionInput): Promise<{ revoked: number }> {
  assertStaffRole(actor, "SUPPORT");
  const { user } = await staffCompanyMember(input.companyId, input.userId);

  return db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { sessionVersion: { increment: 1 } } });
    const revoked = await revokeUserSessions(tx, user.id);
    const memberships = await tx.membership.findMany({ where: { userId: user.id }, select: { companyId: true } });
    for (const { companyId } of memberships) {
      await logActivity(
        {
          companyId,
          actorId: null,
          action: "support.sign_out",
          entityType: "user",
          entityId: user.id,
          summary: `signed ${user.name} out on every device`,
          metadata: { revoked },
        },
        tx,
      );
    }
    await logStaffAction(
      auditorOf(actor),
      {
        action: "staff.sign_out",
        summary: `signed ${user.email} out on every device`,
        companyId: input.companyId,
        targetUserId: user.id,
        metadata: { revoked, reason: input.reason },
      },
      tx,
    );
    return { revoked };
  });
}
