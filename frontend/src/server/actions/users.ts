"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@resumerank/core/db";
import { requireAdmin, requireUser } from "@/lib/auth/guards";
import { roleSchema } from "@resumerank/core/validators/enums";
import {
  changePasswordSchema,
  deleteAccountSchema,
  notificationPreferencesSchema,
  updateProfileSchema,
} from "@resumerank/core/validators/user";
import { hashPassword, verifyPassword } from "@resumerank/core/auth/password";
import { runAction } from "@/server/run-action";
import { logActivity } from "@resumerank/core/activity";
import { actionError, actionOk, type ActionResult } from "@resumerank/core/types/action";
import type { TeamMember } from "@/server/queries/users";

const TEAM_MEMBER_SELECT = {
  id: true,
  name: true,
  email: true,
  image: true,
  role: true,
  emailVerified: true,
  createdAt: true,
} as const;

const updateUserRoleSchema = z.object({
  userId: z.string().min(1),
  role: roleSchema,
});

export async function updateUserRoleAction(
  input: unknown,
): Promise<ActionResult<TeamMember>> {
  return runAction(async () => {
    const parsed = updateUserRoleSchema.safeParse(input);
    if (!parsed.success) {
      return actionError(
        "Check the highlighted fields.",
        parsed.error.flatten().fieldErrors,
      );
    }
    const admin = await requireAdmin();
    const { userId, role } = parsed.data;

    if (userId === admin.id) {
      return actionError("You can't change your own role.");
    }

    const target = await db.user.findFirst({
      where: { id: userId, companyId: admin.companyId },
      select: { id: true, role: true },
    });
    if (!target) {
      return actionError("That user no longer exists.");
    }
    if (target.role === "OWNER" && admin.role !== "OWNER") {
      return actionError("Only an owner can change another owner's role.");
    }
    if (role === "OWNER" && admin.role !== "OWNER") {
      return actionError("Only an owner can assign the owner role.");
    }

    const user = await db.user.update({
      where: { id: userId },
      data: { role },
      select: TEAM_MEMBER_SELECT,
    });

    await logActivity({
      companyId: admin.companyId,
      actorId: admin.id,
      action: "user.role",
      entityType: "user",
      entityId: user.id,
      summary: `changed ${user.name}'s role to ${role}`,
      metadata: { from: target.role, to: role },
    });

    revalidatePath("/settings/team");

    return actionOk(user);
  });
}

export async function updateProfileAction(
  input: unknown,
): Promise<ActionResult<TeamMember>> {
  return runAction(async () => {
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

    const user = await db.user.update({
      where: { id: currentUser.id },
      data,
      select: TEAM_MEMBER_SELECT,
    });

    // Onboarding users (no company yet) have nothing to scope the log to.
    if (currentUser.companyId) {
      await logActivity({
        companyId: currentUser.companyId,
        actorId: currentUser.id,
        action: "user.profile",
        entityType: "user",
        entityId: user.id,
        summary: "updated their profile",
      });
    }

    revalidatePath("/settings/team");
    revalidatePath("/settings");

    return actionOk(user);
  });
}

export async function changePasswordAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const parsed = changePasswordSchema.safeParse(input);
    if (!parsed.success) {
      return actionError(
        "Check the highlighted fields.",
        parsed.error.flatten().fieldErrors,
      );
    }
    const currentUser = await requireUser();

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

    const passwordHash = await hashPassword(parsed.data.newPassword);
    await db.user.update({
      where: { id: currentUser.id },
      data: { passwordHash },
    });

    if (currentUser.companyId) {
      await logActivity({
        companyId: currentUser.companyId,
        actorId: currentUser.id,
        action: "user.password",
        entityType: "user",
        entityId: currentUser.id,
        summary: "changed their password",
      });
    }

    return actionOk({ id: currentUser.id });
  });
}

export async function updateNotificationPreferencesAction(
  input: unknown,
): Promise<ActionResult<{ notifyByEmail: boolean }>> {
  return runAction(async () => {
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

export async function deleteAccountAction(
  input: unknown,
): Promise<ActionResult<{ deleted: true }>> {
  return runAction(async () => {
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

    // The workspace's shared jobs, candidates and applications are re-homed to
    // an owner so deleting a teammate never destroys team data. Owners must
    // hand off the role first — otherwise there'd be no one to inherit it.
    // A company-less (onboarding) user owns no shared data, so there's no
    // inheritor to find and nothing to reassign.
    const inheritor = currentUser.companyId
      ? await db.user.findFirst({
          where: {
            role: "OWNER",
            companyId: currentUser.companyId,
            id: { not: currentUser.id },
          },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        })
      : null;
    if (currentUser.companyId && !inheritor) {
      return actionError(
        currentUser.role === "OWNER"
          ? "Transfer the owner role to a teammate before deleting your account."
          : "Your workspace has no other owner to inherit your data. Contact support.",
      );
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

    await db.$transaction(async (tx) => {
      if (inheritor) {
        const reassign = { createdById: inheritor.id };
        await tx.job.updateMany({
          where: { createdById: currentUser.id },
          data: reassign,
        });
        await tx.candidate.updateMany({
          where: { createdById: currentUser.id },
          data: reassign,
        });
        await tx.application.updateMany({
          where: { createdById: currentUser.id },
          data: reassign,
        });
      }
      await tx.activityLog.deleteMany({ where: { actorId: currentUser.id } });
      await tx.user.delete({ where: { id: currentUser.id } });
    });

    return actionOk({ deleted: true });
  });
}
