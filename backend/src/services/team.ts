import { db } from "../db";
import { logActivity } from "../activity";
import { createCompanyInvite } from "../auth/tokens";
import { sendInviteEmail } from "../email";
import { AUTH_LIMIT, rateLimit } from "../rate-limit";
import type { Prisma } from "../generated/prisma/client";
import type { InviteMemberInput } from "../validators/company";
import type { Role } from "../validators/enums";
import type { RemoveMemberInput } from "../validators/user";
import { assertCanAdmin, type TenantContext } from "./context";
import { ConflictError, DomainError, ForbiddenError, NotFoundError } from "./errors";

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: Role;
  emailVerified: Date | null;
  createdAt: Date;
}

export interface PendingInvite {
  id: string;
  email: string;
  role: Role;
  expiresAt: Date;
  invitedByName: string;
}

export interface InviteResult {
  id: string;
  email: string;
  role: Role;
  expiresAt: Date;
}

const TEAM_MEMBER_SELECT = {
  id: true,
  name: true,
  email: true,
  image: true,
  role: true,
  emailVerified: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

const USER_NOT_FOUND = "That user no longer exists.";

/** Postgres sorts the native Role enum by declaration order (OWNER, ADMIN, MEMBER, VIEWER). */
export async function listTeam(ctx: TenantContext): Promise<TeamMember[]> {
  return db.user.findMany({
    where: { companyId: ctx.companyId },
    select: TEAM_MEMBER_SELECT,
    orderBy: [{ role: "asc" }, { name: "asc" }, { id: "asc" }],
  });
}

export async function listPendingInvites(ctx: TenantContext): Promise<PendingInvite[]> {
  const invites = await db.companyInvite.findMany({
    where: {
      companyId: ctx.companyId,
      acceptedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: { invitedBy: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  return invites.map((invite) => ({
    id: invite.id,
    email: invite.email,
    role: invite.role,
    expiresAt: invite.expiresAt,
    invitedByName: invite.invitedBy.name,
  }));
}

export async function updateMemberRole(
  ctx: TenantContext,
  input: { userId: string; role: Role },
): Promise<TeamMember> {
  assertCanAdmin(ctx);
  const { userId, role } = input;

  if (userId === ctx.actorId) {
    throw new ForbiddenError("You can't change your own role.");
  }
  if (role === "OWNER" && ctx.role !== "OWNER") {
    throw new ForbiddenError("Only an owner can assign the owner role.");
  }

  return db.$transaction(async (tx) => {
    const target = await tx.user.findFirst({
      where: { id: userId, companyId: ctx.companyId },
      select: { role: true },
    });
    if (!target) throw new NotFoundError(USER_NOT_FOUND);
    if (target.role === "OWNER" && ctx.role !== "OWNER") {
      throw new ForbiddenError("Only an owner can change another owner's role.");
    }

    const user = await tx.user.update({
      where: { id: userId, companyId: ctx.companyId },
      data: { role },
      select: TEAM_MEMBER_SELECT,
    });
    await logActivity(
      {
        companyId: ctx.companyId,
        actorId: ctx.actorId,
        action: "user.role",
        entityType: "user",
        entityId: user.id,
        summary: `changed ${user.name}'s role to ${role}`,
        metadata: { from: target.role, to: role },
      },
      tx,
    );
    return user;
  });
}

/**
 * Detaches a teammate from the workspace. Their account survives (they can
 * be re-invited or start their own company) and the records they created stay
 * with the company. Access ends on their next request: the guards re-read
 * `companyId` from the database, and their open sessions are revoked.
 */
export async function removeMember(
  ctx: TenantContext,
  input: RemoveMemberInput,
): Promise<TeamMember> {
  assertCanAdmin(ctx);
  const { userId } = input;

  if (userId === ctx.actorId) {
    throw new ForbiddenError(
      "You can't remove yourself. Delete your account from Account settings instead.",
    );
  }

  return db.$transaction(async (tx) => {
    const target = await tx.user.findFirst({
      where: { id: userId, companyId: ctx.companyId },
      select: { role: true },
    });
    if (!target) throw new NotFoundError(USER_NOT_FOUND);
    if (target.role === "OWNER" && ctx.role !== "OWNER") {
      throw new ForbiddenError("Only an owner can remove another owner.");
    }

    // The role resets so an elevated role never carries into whatever
    // workspace the user joins next.
    const user = await tx.user.update({
      where: { id: userId, companyId: ctx.companyId },
      data: { companyId: null, role: "MEMBER", sessionVersion: { increment: 1 } },
      select: TEAM_MEMBER_SELECT,
    });
    await logActivity(
      {
        companyId: ctx.companyId,
        actorId: ctx.actorId,
        action: "user.remove",
        entityType: "user",
        entityId: user.id,
        summary: `removed ${user.name} from the workspace`,
        metadata: { role: target.role },
      },
      tx,
    );
    return user;
  });
}

/**
 * The invite row and its audit entry commit before the email is sent, so a
 * failed send leaves a valid, logged invite the admin can simply re-send.
 */
export async function inviteMember(
  ctx: TenantContext,
  input: InviteMemberInput,
): Promise<InviteResult> {
  assertCanAdmin(ctx);
  const { email, role } = input;

  // Each invite sends an email, so the sender is throttled like a login attempt.
  const limited = rateLimit(`invite:${ctx.actorId}`, AUTH_LIMIT);
  if (!limited.allowed) {
    const minutes = Math.max(1, Math.ceil(limited.retryAfterSeconds / 60));
    throw new DomainError(
      `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    );
  }

  const [inviter, company, existingUser] = await Promise.all([
    db.user.findUnique({ where: { id: ctx.actorId }, select: { name: true, email: true } }),
    db.company.findUnique({ where: { id: ctx.companyId }, select: { name: true } }),
    db.user.findUnique({ where: { email }, select: { companyId: true } }),
  ]);
  if (!inviter || !company) {
    throw new NotFoundError("Your company no longer exists.");
  }
  if (email === inviter.email.toLowerCase()) {
    throw new DomainError("You can't invite yourself.");
  }
  if (existingUser?.companyId) {
    throw new ConflictError("That person already belongs to a company.");
  }

  const { invite, rawToken } = await db.$transaction(async (tx) => {
    const created = await createCompanyInvite(
      { companyId: ctx.companyId, email, role, invitedById: ctx.actorId },
      tx,
    );
    await logActivity(
      {
        companyId: ctx.companyId,
        actorId: ctx.actorId,
        action: "user.invite",
        entityType: "user",
        entityId: created.invite.id,
        summary: `invited ${email} as ${role.toLowerCase()}`,
      },
      tx,
    );
    return created;
  });

  await sendInviteEmail({
    to: email,
    token: rawToken,
    companyName: company.name,
    inviterName: inviter.name,
  });

  return {
    id: invite.id,
    email: invite.email,
    role: invite.role,
    expiresAt: invite.expiresAt,
  };
}

export async function revokeInvite(
  ctx: TenantContext,
  inviteId: string,
): Promise<{ id: string }> {
  assertCanAdmin(ctx);

  return db.$transaction(async (tx) => {
    const { count } = await tx.companyInvite.deleteMany({
      where: { id: inviteId, companyId: ctx.companyId },
    });
    if (count === 0) throw new NotFoundError("That invite no longer exists.");

    await logActivity(
      {
        companyId: ctx.companyId,
        actorId: ctx.actorId,
        action: "user.invite_revoked",
        entityType: "user",
        entityId: inviteId,
        summary: "revoked a pending invite",
      },
      tx,
    );
    return { id: inviteId };
  });
}
