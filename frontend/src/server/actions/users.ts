"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@resumerank/core/db";
import { refreshSession, signOut } from "@/lib/auth";
import { requireAdmin, requirePasswordChange, requireUser, tenantContext } from "@/lib/auth/guards";
import { roleSchema } from "@resumerank/core/validators/enums";
import {
  changePasswordSchema,
  deleteAccountSchema,
  notificationPreferencesSchema,
  removeMemberSchema,
  updateProfileSchema,
} from "@resumerank/core/validators/user";
import { hashPassword, verifyPassword } from "@resumerank/core/auth/password";
import { accountPasswordPolicy, assertPasswordAllowed } from "@resumerank/core/auth/password-policy";
import { revokeUserSessions } from "@resumerank/core/auth/sessions";
import { expireTenantReads } from "@/server/cache-tags";
import { runAction } from "@/server/run-action";
import { logActivity } from "@resumerank/core/activity";
import { actionError, actionOk, type ActionResult } from "@resumerank/core/types/action";
import { transferOwnershipSchema } from "@resumerank/core/validators/company";
import {
  removeMember,
  transferOwnership,
  updateMemberRole,
  type OwnershipTransfer,
  type TeamMember,
} from "@resumerank/core/services/team";

const PROFILE_SELECT = {
  id: true,
  name: true,
  email: true,
  image: true,
  emailVerified: true,
  mfaEnabledAt: true,
  createdAt: true,
} as const;

const updateUserRoleSchema = z.object({
  userId: z.string().min(1),
  role: roleSchema,
});

export async function updateUserRoleAction(
  input: unknown,
): Promise<ActionResult<TeamMember>> {
  return runAction("updateUserRole", async () => {
    const parsed = updateUserRoleSchema.safeParse(input);
    if (!parsed.success) {
      return actionError(
        "Check the highlighted fields.",
        parsed.error.flatten().fieldErrors,
      );
    }
    const admin = await requireAdmin();
    const user = await updateMemberRole(tenantContext(admin), parsed.data);

    revalidatePath("/settings/team");
    expireTenantReads(admin.companyId);

    return actionOk(user);
  });
}

export async function removeMemberAction(
  input: unknown,
): Promise<ActionResult<TeamMember>> {
  return runAction("removeMember", async () => {
    const parsed = removeMemberSchema.safeParse(input);
    if (!parsed.success) {
      return actionError(
        "Check the highlighted fields.",
        parsed.error.flatten().fieldErrors,
      );
    }
    const admin = await requireAdmin();
    const user = await removeMember(tenantContext(admin), parsed.data);

    revalidatePath("/settings/team");
    expireTenantReads(admin.companyId);

    return actionOk(user);
  });
}

export async function updateProfileAction(
  input: unknown,
): Promise<ActionResult<TeamMember>> {
  return runAction("updateProfile", async () => {
    const parsed = updateProfileSchema.safeParse(input);
    if (!parsed.success) {
      return actionError(
        "Check the highlighted fields.",
        parsed.error.flatten().fieldErrors,
      );
    }
    const currentUser = await requireUser();

    const data: { name: string; image?: string | null } = {
      name: parsed.data.name,
    };
    if (parsed.data.image !== undefined) {
      data.image = parsed.data.image === "" ? null : parsed.data.image;
    }

    const companyId = currentUser.companyId;
    const user = await db.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: currentUser.id },
        data,
        select: PROFILE_SELECT,
      });
      // Onboarding users (no company yet) have nothing to scope the log to.
      if (companyId) {
        await logActivity(
          {
            companyId,
            actorId: currentUser.id,
            action: "user.profile",
            entityType: "user",
            entityId: updated.id,
            summary: "updated their profile",
          },
          tx,
        );
      }
      return { ...updated, role: currentUser.role };
    });

    revalidatePath("/settings/team");
    revalidatePath("/settings");
    expireTenantReads(companyId);

    return actionOk(user);
  });
}

export async function changePasswordAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return runAction("changePassword", async () => {
    const parsed = changePasswordSchema.safeParse(input);
    if (!parsed.success) {
      return actionError(
        "Check the highlighted fields.",
        parsed.error.flatten().fieldErrors,
      );
    }
    const { user: currentUser, loginId } = await requirePasswordChange();

    const record = await db.user.findUnique({
      where: { id: currentUser.id },
      select: { passwordHash: true },
    });
    if (!record?.passwordHash) {
      return actionError(
        "Your account signs in with Google, so there's no password to change.",
      );
    }

    const matches = await verifyPassword(
      parsed.data.currentPassword,
      record.passwordHash,
    );
    if (!matches) {
      return actionError("Your current password is incorrect.", {
        currentPassword: ["Incorrect password"],
      });
    }

    const reused = await verifyPassword(
      parsed.data.newPassword,
      record.passwordHash,
    );
    if (reused) {
      return actionError("Choose a password different from your current one.", {
        newPassword: ["Choose a different password"],
      });
    }

    await assertPasswordAllowed(parsed.data.newPassword, await accountPasswordPolicy(currentUser.id), "newPassword");

    // Signs out every other device; this one is re-stamped so the user who
    // just proved the old password stays signed in, and released if the
    // password policy was holding it.
    const passwordHash = await hashPassword(parsed.data.newPassword);
    const companyId = currentUser.companyId;
    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: currentUser.id },
        data: { passwordHash, sessionVersion: { increment: 1 } },
      });
      await revokeUserSessions(tx, currentUser.id, loginId);
      await tx.loginSession.updateMany({
        where: { id: loginId, userId: currentUser.id },
        data: { passwordChangeRequired: false },
      });
      if (companyId) {
        await logActivity(
          {
            companyId,
            actorId: currentUser.id,
            action: "user.password",
            entityType: "user",
            entityId: currentUser.id,
            summary: "changed their password",
          },
          tx,
        );
      }
    });
    await refreshSession({});
    expireTenantReads(companyId);

    return actionOk({ id: currentUser.id });
  });
}

/** Revokes every session for this account, including the current one. */
export async function signOutEverywhereAction(): Promise<void> {
  const currentUser = await requireUser();
  const companyId = currentUser.companyId;
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: currentUser.id },
      data: { sessionVersion: { increment: 1 } },
    });
    await revokeUserSessions(tx, currentUser.id);
    if (companyId) {
      await logActivity(
        {
          companyId,
          actorId: currentUser.id,
          action: "user.sign_out_everywhere",
          entityType: "user",
          entityId: currentUser.id,
          summary: "signed out of all devices",
        },
        tx,
      );
    }
  });
  expireTenantReads(companyId);
  await signOut({ redirectTo: "/login" });
}

export async function updateNotificationPreferencesAction(
  input: unknown,
): Promise<ActionResult<{ notifyByEmail: boolean }>> {
  return runAction("updateNotificationPreferences", async () => {
    const parsed = notificationPreferencesSchema.safeParse(input);
    if (!parsed.success) {
      return actionError(
        "Check the highlighted fields.",
        parsed.error.flatten().fieldErrors,
      );
    }
    const currentUser = await requireUser();

    const user = await db.user.update({
      where: { id: currentUser.id },
      data: { notifyByEmail: parsed.data.notifyByEmail },
      select: { notifyByEmail: true },
    });

    revalidatePath("/settings/account");

    return actionOk(user);
  });
}

export async function transferOwnershipAction(
  input: unknown,
): Promise<ActionResult<OwnershipTransfer>> {
  return runAction("transferOwnership", async () => {
    const parsed = transferOwnershipSchema.safeParse(input);
    if (!parsed.success) {
      return actionError(
        "Check the highlighted fields.",
        parsed.error.flatten().fieldErrors,
      );
    }
    const admin = await requireAdmin();
    const transfer = await transferOwnership(tenantContext(admin), parsed.data);

    // The caller's own role changed, so every owner-only settings page re-renders.
    revalidatePath("/settings", "layout");
    expireTenantReads(admin.companyId);

    return actionOk(transfer);
  });
}

export async function deleteAccountAction(
  input: unknown,
): Promise<ActionResult<{ deleted: true }>> {
  return runAction("deleteAccount", async () => {
    const parsed = deleteAccountSchema.safeParse(input);
    if (!parsed.success) {
      return actionError(
        "Check the highlighted fields.",
        parsed.error.flatten().fieldErrors,
      );
    }
    const currentUser = await requireUser();

    if (
      parsed.data.confirmEmail.toLowerCase() !== currentUser.email.toLowerCase()
    ) {
      return actionError("That email doesn't match your account.", {
        confirmEmail: ["Enter your account email exactly"],
      });
    }

    // Each workspace's shared jobs, candidates and applications are re-homed
    // to one of its other owners, so deleting a teammate never destroys team
    // data. An owner must hand off the role first wherever they're the only
    // one — otherwise there'd be no one to inherit it. Memberships are read
    // by the user's own id: the account spans every workspace it belongs to.
    const memberships = await db.membership.findMany({
      where: { userId: currentUser.id },
      orderBy: { createdAt: "asc" },
      select: { companyId: true, role: true, company: { select: { name: true } } },
    });
    const inheritors = new Map<string, string>();
    for (const membership of memberships) {
      const inheritor = await db.membership.findFirst({
        where: { companyId: membership.companyId, role: "OWNER", userId: { not: currentUser.id } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { userId: true },
      });
      if (!inheritor) {
        return actionError(
          membership.role === "OWNER"
            ? `Transfer ownership of ${membership.company.name} to a teammate (Settings → Company) before deleting your account.`
            : `${membership.company.name} has no other owner to inherit your data. Contact support.`,
        );
      }
      inheritors.set(membership.companyId, inheritor.userId);
    }

    const record = await db.user.findUnique({
      where: { id: currentUser.id },
      select: { passwordHash: true },
    });
    if (record?.passwordHash) {
      if (!parsed.data.password) {
        return actionError("Enter your password to confirm.", {
          password: ["Password is required"],
        });
      }
      const matches = await verifyPassword(
        parsed.data.password,
        record.passwordHash,
      );
      if (!matches) {
        return actionError("Your password is incorrect.", {
          password: ["Incorrect password"],
        });
      }
    }

    // Activity rows are left untouched: the FK nulls their actor on delete, so
    // each company's audit trail survives with the author anonymised.
    await db.$transaction(async (tx) => {
      for (const [companyId, inheritorId] of inheritors) {
        const owned = { createdById: currentUser.id, companyId };
        const reassign = { createdById: inheritorId };
        await tx.job.updateMany({ where: owned, data: reassign });
        await tx.candidate.updateMany({ where: owned, data: reassign });
        await tx.application.updateMany({ where: owned, data: reassign });
      }
      await tx.user.delete({ where: { id: currentUser.id } });
    });
    for (const companyId of inheritors.keys()) expireTenantReads(companyId);

    return actionOk({ deleted: true });
  });
}
