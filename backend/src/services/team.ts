import { tenantDb, tenantTransaction, type TenantTx } from "../tenant-db";
import { logActivity } from "../activity";
import { revokeWorkspaceSessions } from "../auth/sessions";
import { createCompanyInvite } from "../auth/tokens";
import { queueInviteEmail } from "../email/messages";
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
  /** Null while the member has no second factor. */
  mfaEnabledAt: Date | null;
  /** When they joined this workspace. */
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

/** A teammate is a membership: the role is this workspace's, the person is the account. */
export const TEAM_MEMBER_SELECT = {
  role: true,
  createdAt: true,
  user: {
    select: { id: true, name: true, email: true, image: true, emailVerified: true, mfaEnabledAt: true },
  },
} satisfies Prisma.MembershipSelect;

type TeamMemberRow = Prisma.MembershipGetPayload<{ select: typeof TEAM_MEMBER_SELECT }>;

export function toTeamMember({ role, createdAt, user }: TeamMemberRow): TeamMember {
  return { ...user, role, createdAt };
}

const USER_NOT_FOUND = "That user no longer exists.";

/** Postgres sorts the native Role enum by declaration order (OWNER, ADMIN, MEMBER, VIEWER). */
export async function listTeam(ctx: TenantContext): Promise<TeamMember[]> {
  const members = await tenantDb(ctx).membership.findMany({
    where: { companyId: ctx.companyId },
    select: TEAM_MEMBER_SELECT,
    orderBy: [{ role: "asc" }, { user: { name: "asc" } }, { userId: "asc" }],
  });
  return members.map(toTeamMember);
}

/** A teammate's membership in this workspace, inside a tenant transaction. */
export async function findTeammate(
  tx: TenantTx,
  ctx: TenantContext,
  userId: string,
): Promise<TeamMemberRow & { id: string }> {
  const membership = await tx.membership.findUnique({
    where: { userId_companyId: { userId, companyId: ctx.companyId } },
    select: { id: true, ...TEAM_MEMBER_SELECT },
  });
  if (!membership) throw new NotFoundError(USER_NOT_FOUND);
  return membership;
}

export async function listPendingInvites(ctx: TenantContext): Promise<PendingInvite[]> {
  const invites = await tenantDb(ctx).companyInvite.findMany({
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

  return tenantTransaction(ctx, async (tx) => {
    const target = await findTeammate(tx, ctx, userId);
    if (target.role === "OWNER" && ctx.role !== "OWNER") {
      throw new ForbiddenError("Only an owner can change another owner's role.");
    }

    const user = toTeamMember(
      await tx.membership.update({
        where: { id: target.id, companyId: ctx.companyId },
        data: { role },
        select: TEAM_MEMBER_SELECT,
      }),
    );
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
 * Detaches a teammate from the workspace. Their account survives, with any
 * other workspaces they belong to (they can be re-invited or start their own
 * company), and the records they created stay with the company. Access ends
 * on their next request: the guards re-read memberships from the database,
 * and the sessions they have open here are revoked.
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

  return tenantTransaction(ctx, async (tx) => {
    const target = await findTeammate(tx, ctx, userId);
    if (target.role === "OWNER" && ctx.role !== "OWNER") {
      throw new ForbiddenError("Only an owner can remove another owner.");
    }

    // Before the delete below: once they leave the company, RLS hides their sessions.
    await revokeWorkspaceSessions(tx, userId, ctx.companyId);
    await tx.membership.delete({ where: { id: target.id, companyId: ctx.companyId } });
    const user = toTeamMember(target);
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
 * The invite row, its audit entry and the queued email commit together, so
 * every invite that exists has its email on the way; the outbox retries a
 * failed send, and an admin can still re-send to mint a fresh link.
 */
export async function inviteMember(
  ctx: TenantContext,
  input: InviteMemberInput,
): Promise<InviteResult> {
  assertCanAdmin(ctx);
  const { email, role } = input;

  // Each invite sends an email, so the sender is throttled like a login attempt.
  const limited = await rateLimit(`invite:${ctx.actorId}`, AUTH_LIMIT);
  if (!limited.allowed) {
    const minutes = Math.max(1, Math.ceil(limited.retryAfterSeconds / 60));
    throw new DomainError(
      `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    );
  }

  const [inviter, company, alreadyMember] = await Promise.all([
    tenantDb(ctx).user.findUnique({ where: { id: ctx.actorId }, select: { name: true, email: true } }),
    tenantDb(ctx).company.findUnique({ where: { id: ctx.companyId }, select: { name: true } }),
    tenantDb(ctx).membership.count({ where: { companyId: ctx.companyId, user: { email } } }),
  ]);
  if (!inviter || !company) {
    throw new NotFoundError("Your company no longer exists.");
  }
  if (email === inviter.email.toLowerCase()) {
    throw new DomainError("You can't invite yourself.");
  }
  // People in other workspaces can be invited: they accept with the same account.
  if (alreadyMember > 0) {
    throw new ConflictError("That person is already a member of this workspace.");
  }

  const invite = await tenantTransaction(ctx, async (tx) => {
    const created = await createCompanyInvite(
      { companyId: ctx.companyId, email, role, invitedById: ctx.actorId },
      tx,
    );
    await queueInviteEmail(
      { to: email, token: created.rawToken, companyName: company.name, inviterName: inviter.name },
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
    return created.invite;
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

  return tenantTransaction(ctx, async (tx) => {
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
