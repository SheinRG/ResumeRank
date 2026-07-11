"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin, requireUser } from "@/lib/auth/guards";
import { roleSchema } from "@/lib/validators/enums";
import { runAction } from "@/server/run-action";
import { logActivity } from "@/server/activity";
import { actionError, actionOk, type ActionResult } from "@/types/action";
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

    const target = await db.user.findUnique({
      where: { id: userId },
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

const updateProfileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters")
    .max(80, "Name must be at most 80 characters"),
});

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

    const user = await db.user.update({
      where: { id: currentUser.id },
      data: { name: parsed.data.name },
      select: TEAM_MEMBER_SELECT,
    });

    await logActivity({
      actorId: currentUser.id,
      action: "user.profile",
      entityType: "user",
      entityId: user.id,
      summary: "updated their profile",
    });

    revalidatePath("/settings/team");
    revalidatePath("/settings");

    return actionOk(user);
  });
}
