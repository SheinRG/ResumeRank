"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { AuthError } from "next-auth";
import { db } from "@resumerank/core/db";
import { signIn } from "@/lib/auth";
import { requireAdmin, requireUser, tenantContext } from "@/lib/auth/guards";
import { withUniqueCompanySlug } from "@resumerank/core/company";
import { hashPassword } from "@resumerank/core/auth/password";
import { claimInvite, findValidInviteByToken } from "@resumerank/core/auth/tokens";
import { updateCompany, type CompanyDetail } from "@resumerank/core/services/company";
import {
  inviteMember,
  revokeInvite,
  type InviteResult,
} from "@resumerank/core/services/team";
import {
  acceptInviteSchema,
  companyNameSchema,
  inviteMemberSchema,
  updateCompanySchema,
} from "@resumerank/core/validators/company";
import { runAction } from "@/server/run-action";
import { logActivity } from "@resumerank/core/activity";
import { actionError, actionOk, type ActionResult } from "@resumerank/core/types/action";

const createCompanySchema = z.object({ companyName: companyNameSchema });
const inviteIdSchema = z.string().min(1, "Invite is missing");

export async function createCompanyAction(
  input: unknown,
): Promise<ActionResult<{ id: string; name: string; slug: string }>> {
  return runAction("createCompany", async () => {
    const parsed = createCompanySchema.safeParse(input);
    if (!parsed.success) {
      return actionError(
        "Check the highlighted fields.",
        parsed.error.flatten().fieldErrors,
      );
    }
    const user = await requireUser();
    if (user.companyId) {
      return actionError("You already belong to a company.");
    }

    const company = await withUniqueCompanySlug(parsed.data.companyName, (slug) =>
      db.$transaction(async (tx) => {
        const created = await tx.company.create({
          data: { name: parsed.data.companyName, slug },
        });
        await tx.user.update({
          where: { id: user.id },
          data: { companyId: created.id, role: "OWNER" },
        });
        await logActivity(
          {
            companyId: created.id,
            actorId: user.id,
            action: "company.create",
            entityType: "user",
            entityId: user.id,
            summary: `created ${created.name}`,
          },
          tx,
        );
        return created;
      }),
    );

    return actionOk({ id: company.id, name: company.name, slug: company.slug });
  });
}

export async function updateCompanyAction(
  input: unknown,
): Promise<ActionResult<CompanyDetail>> {
  return runAction("updateCompany", async () => {
    const parsed = updateCompanySchema.safeParse(input);
    if (!parsed.success) {
      return actionError(
        "Check the highlighted fields.",
        parsed.error.flatten().fieldErrors,
      );
    }
    const admin = await requireAdmin();
    const company = await updateCompany(tenantContext(admin), parsed.data);

    revalidatePath("/settings/company");

    return actionOk(company);
  });
}

export async function acceptPendingInviteAction(
  inviteId: unknown,
): Promise<ActionResult<{ companyId: string }>> {
  return runAction("acceptPendingInvite", async () => {
    const parsed = inviteIdSchema.safeParse(inviteId);
    if (!parsed.success) {
      return actionError("That invite could not be found.");
    }
    const user = await requireUser();
    if (user.companyId) {
      return actionError("You already belong to a company.");
    }

    const invite = await db.companyInvite.findUnique({ where: { id: parsed.data } });
    if (!invite || invite.acceptedAt !== null || invite.expiresAt < new Date()) {
      return actionError("This invite is no longer valid.");
    }
    if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
      return actionError("This invite was sent to a different email address.");
    }

    const joined = await db.$transaction(async (tx) => {
      if (!(await claimInvite(tx, invite.id))) return false;
      await tx.user.update({
        where: { id: user.id },
        data: { companyId: invite.companyId, role: invite.role },
      });
      await logActivity(
        {
          companyId: invite.companyId,
          actorId: user.id,
          action: "user.join",
          entityType: "user",
          entityId: user.id,
          summary: `${user.name} joined the company`,
        },
        tx,
      );
      return true;
    });
    if (!joined) {
      return actionError("This invite is no longer valid.");
    }

    return actionOk({ companyId: invite.companyId });
  });
}

export async function inviteMemberAction(
  input: unknown,
): Promise<ActionResult<InviteResult>> {
  return runAction("inviteMember", async () => {
    const parsed = inviteMemberSchema.safeParse(input);
    if (!parsed.success) {
      return actionError(
        "Check the highlighted fields.",
        parsed.error.flatten().fieldErrors,
      );
    }
    const admin = await requireAdmin();
    const invite = await inviteMember(tenantContext(admin), parsed.data);

    revalidatePath("/settings/team");

    return actionOk(invite);
  });
}

export async function revokeInviteAction(
  inviteId: unknown,
): Promise<ActionResult<{ id: string }>> {
  return runAction("revokeInvite", async () => {
    const parsed = inviteIdSchema.safeParse(inviteId);
    if (!parsed.success) {
      return actionError("That invite could not be found.");
    }
    const admin = await requireAdmin();
    const revoked = await revokeInvite(tenantContext(admin), parsed.data);

    revalidatePath("/settings/team");

    return actionOk(revoked);
  });
}

export async function acceptInviteAction(
  input: unknown,
): Promise<ActionResult<undefined>> {
  return runAction("acceptInvite", async () => {
    const parsed = acceptInviteSchema.safeParse(input);
    if (!parsed.success) {
      return actionError(
        "Check the highlighted fields.",
        parsed.error.flatten().fieldErrors,
      );
    }

    const invite = await findValidInviteByToken(parsed.data.token);
    if (!invite) {
      return actionError(
        "This invite link is invalid or has expired. Ask your admin to send a new one.",
      );
    }

    const existing = await db.user.findUnique({ where: { email: invite.email } });
    if (existing) {
      return actionError("An account with this email already exists. Log in instead.");
    }

    const passwordHash = await hashPassword(parsed.data.password);
    const created = await db.$transaction(async (tx) => {
      if (!(await claimInvite(tx, invite.id))) return null;
      const user = await tx.user.create({
        data: {
          name: parsed.data.name,
          email: invite.email,
          // The emailed link proves ownership of this address, so it's
          // verified the moment the account is created.
          emailVerified: new Date(),
          passwordHash,
          role: invite.role,
          companyId: invite.companyId,
        },
      });
      await logActivity(
        {
          companyId: invite.companyId,
          actorId: user.id,
          action: "user.join",
          entityType: "user",
          entityId: user.id,
          summary: `${user.name} joined via invite`,
        },
        tx,
      );
      return user;
    });
    if (!created) {
      return actionError(
        "This invite link is invalid or has expired. Ask your admin to send a new one.",
      );
    }

    try {
      await signIn("credentials", {
        email: invite.email,
        password: parsed.data.password,
        redirect: false,
      });
    } catch (error) {
      if (error instanceof AuthError) {
        return actionError("Account created, but automatic sign-in failed. Log in instead.");
      }
      throw error;
    }

    return actionOk(undefined);
  });
}
