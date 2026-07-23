"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { AuthError } from "next-auth";
import { db } from "@resumerank/core/db";
import { signIn } from "@/lib/auth";
import { requireAdmin, requireUser } from "@/lib/auth/guards";
import { generateCompanySlug } from "@resumerank/core/company";
import { hashPassword } from "@resumerank/core/auth/password";
import { createCompanyInvite, consumeInviteToken } from "@resumerank/core/auth/tokens";
import { sendInviteEmail } from "@resumerank/core/email";
import { AUTH_LIMIT, rateLimit } from "@resumerank/core/rate-limit";
import {
  acceptInviteSchema,
  companyNameSchema,
  inviteMemberSchema,
  updateCompanySchema,
} from "@resumerank/core/validators/company";
import type { Role } from "@resumerank/core/validators/enums";
import { runAction } from "@/server/run-action";
import { logActivity } from "@resumerank/core/activity";
import { actionError, actionOk, type ActionResult } from "@resumerank/core/types/action";
import { COMPANY_DETAIL_SELECT, type CompanyDetail } from "@/server/queries/company";

function tooManyAttempts(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

const createCompanySchema = z.object({ companyName: companyNameSchema });
const inviteIdSchema = z.string().min(1, "Invite is missing");

export interface InviteResult {
  id: string;
  email: string;
  role: Role;
  expiresAt: Date;
}

export async function createCompanyAction(
  input: unknown,
): Promise<ActionResult<{ id: string; name: string; slug: string }>> {
  return runAction(async () => {
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

    const company = await db.$transaction(async (tx) => {
      const slug = await generateCompanySlug(parsed.data.companyName);
      const created = await tx.company.create({
        data: { name: parsed.data.companyName, slug },
      });
      await tx.user.update({
        where: { id: user.id },
        data: { companyId: created.id, role: "OWNER" },
      });
      return created;
    });

    await logActivity({
      companyId: company.id,
      actorId: user.id,
      action: "company.create",
      entityType: "user",
      entityId: user.id,
      summary: `created ${company.name}`,
    });

    return actionOk({ id: company.id, name: company.name, slug: company.slug });
  });
}

export async function updateCompanyAction(
  input: unknown,
): Promise<ActionResult<CompanyDetail>> {
  return runAction(async () => {
    const parsed = updateCompanySchema.safeParse(input);
    if (!parsed.success) {
      return actionError(
        "Check the highlighted fields.",
        parsed.error.flatten().fieldErrors,
      );
    }
    const admin = await requireAdmin();
    const { name, logoUrl, website, description, industry, size, location } =
      parsed.data;

    const company = await db.company.update({
      where: { id: admin.companyId },
      data: {
        name,
        logoUrl: logoUrl === "" ? null : logoUrl,
        website: website === "" ? null : website,
        description: description ?? null,
        industry: industry ?? null,
        size: size ?? null,
        location: location ?? null,
      },
      select: COMPANY_DETAIL_SELECT,
    });

    await logActivity({
      companyId: admin.companyId,
      actorId: admin.id,
      action: "company.update",
      entityType: "user",
      entityId: admin.id,
      summary: `updated ${company.name}'s company profile`,
    });

    revalidatePath("/settings/company");

    return actionOk(company);
  });
}

export async function acceptPendingInviteAction(
  inviteId: unknown,
): Promise<ActionResult<{ companyId: string }>> {
  return runAction(async () => {
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

    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { companyId: invite.companyId, role: invite.role },
      });
      await tx.companyInvite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      });
    });

    await logActivity({
      companyId: invite.companyId,
      actorId: user.id,
      action: "user.join",
      entityType: "user",
      entityId: user.id,
      summary: `${user.name} joined the company`,
    });

    return actionOk({ companyId: invite.companyId });
  });
}

export async function inviteMemberAction(
  input: unknown,
): Promise<ActionResult<InviteResult>> {
  return runAction(async () => {
    const parsed = inviteMemberSchema.safeParse(input);
    if (!parsed.success) {
      return actionError(
        "Check the highlighted fields.",
        parsed.error.flatten().fieldErrors,
      );
    }
    const admin = await requireAdmin();
    const { email, role } = parsed.data;

    if (email === admin.email.toLowerCase()) {
      return actionError("You can't invite yourself.");
    }

    const limited = rateLimit(`invite:${admin.id}`, AUTH_LIMIT);
    if (!limited.allowed) {
      return actionError(tooManyAttempts(limited.retryAfterSeconds));
    }

    const existingUser = await db.user.findUnique({
      where: { email },
      select: { companyId: true },
    });
    if (existingUser?.companyId) {
      return actionError("That person already belongs to a company.");
    }

    const company = await db.company.findUnique({
      where: { id: admin.companyId },
      select: { name: true },
    });
    if (!company) {
      return actionError("Your company no longer exists.");
    }

    const { invite, rawToken } = await createCompanyInvite({
      companyId: admin.companyId,
      email,
      role,
      invitedById: admin.id,
    });
    await sendInviteEmail({
      to: email,
      token: rawToken,
      companyName: company.name,
      inviterName: admin.name,
    });

    await logActivity({
      companyId: admin.companyId,
      actorId: admin.id,
      action: "user.invite",
      entityType: "user",
      entityId: invite.id,
      summary: `invited ${email} as ${role.toLowerCase()}`,
    });

    revalidatePath("/settings/team");

    return actionOk({
      id: invite.id,
      email: invite.email,
      role: invite.role,
      expiresAt: invite.expiresAt,
    });
  });
}

export async function revokeInviteAction(
  inviteId: unknown,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const parsed = inviteIdSchema.safeParse(inviteId);
    if (!parsed.success) {
      return actionError("That invite could not be found.");
    }
    const admin = await requireAdmin();

    const { count } = await db.companyInvite.deleteMany({
      where: { id: parsed.data, companyId: admin.companyId },
    });
    if (count === 0) {
      return actionError("That invite no longer exists.");
    }

    await logActivity({
      companyId: admin.companyId,
      actorId: admin.id,
      action: "user.invite_revoked",
      entityType: "user",
      entityId: parsed.data,
      summary: "revoked a pending invite",
    });

    revalidatePath("/settings/team");

    return actionOk({ id: parsed.data });
  });
}

export async function acceptInviteAction(
  input: unknown,
): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const parsed = acceptInviteSchema.safeParse(input);
    if (!parsed.success) {
      return actionError(
        "Check the highlighted fields.",
        parsed.error.flatten().fieldErrors,
      );
    }

    const invite = await consumeInviteToken(parsed.data.token);
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
      await tx.companyInvite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      });
      return user;
    });

    await logActivity({
      companyId: invite.companyId,
      actorId: created.id,
      action: "user.join",
      entityType: "user",
      entityId: created.id,
      summary: `${created.name} joined via invite`,
    });

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
