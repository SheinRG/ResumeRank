import { db } from "../db";
import { logActivity } from "../activity";
import { assertSeatAvailable } from "../billing/seats";
import { withUniqueCompanySlug } from "../company";
import type { Prisma } from "../generated/prisma/client";
import { COMPANY_CREATE_LIMIT, rateLimit, retryMessage } from "../rate-limit";
import { ConflictError, DomainError, ForbiddenError, NotFoundError } from "../services/errors";
import type { TenantTx } from "../tenant-db";
import { claimInvite } from "./tokens";
import { landingWorkspace, signInMayOpen, type WorkspaceAccess } from "./workspace-policy";

/**
 * One account can belong to several companies, with a role in each
 * (`Membership`). Each sign-in has one of them open at a time
 * (`LoginSession.companyId`), and the guards resolve it on every request, so
 * leaving or losing a workspace takes effect on the next one.
 *
 * Like sessions, this is the account's own business, not a workspace's: it
 * runs on the owner connection and reads the user's memberships across
 * companies, always keyed by their own id.
 */

/** The sign-in a workspace change applies to. */
export interface WorkspaceActor {
  userId: string;
  loginId: string;
}

const ACCESS_SELECT = {
  role: true,
  companyId: true,
  company: { select: { ssoEnforced: true } },
} satisfies Prisma.MembershipSelect;

async function memberships(
  userId: string,
  client: Pick<Prisma.TransactionClient, "membership"> = db,
): Promise<WorkspaceAccess[]> {
  const rows = await client.membership.findMany({
    where: { userId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: ACCESS_SELECT,
  });
  return rows.map((row) => ({ companyId: row.companyId, role: row.role, ssoEnforced: row.company.ssoEnforced }));
}

/**
 * For a password or Google sign-in: refused only when the user belongs to
 * workspaces and every one of them requires single sign-on. Someone with no
 * workspace yet signs in to onboarding.
 */
export async function passwordSignInRefused(userId: string): Promise<boolean> {
  const all = await memberships(userId);
  return all.length > 0 && landingWorkspace(all, { preferred: null, ssoCompanyId: null }) === null;
}

/** Where a sign-in that's being recorded should open, given who vouched for it. */
export async function signInLanding(
  tx: Prisma.TransactionClient,
  userId: string,
  ssoCompanyId: string | null,
): Promise<string | null> {
  const [all, user] = await Promise.all([
    memberships(userId, tx),
    tx.user.findUnique({ where: { id: userId }, select: { companyId: true } }),
  ]);
  return landingWorkspace(all, { preferred: user?.companyId ?? null, ssoCompanyId })?.companyId ?? null;
}

/**
 * Points this sign-in at a workspace the user belongs to, and makes it where
 * their next sign-in opens. The default's mirrored role is read from the
 * membership in the same statement; `app.workspace_switch` tells the
 * compatibility trigger this isn't an old-code membership change.
 */
export async function openWorkspace(
  tx: Prisma.TransactionClient,
  actor: WorkspaceActor,
  companyId: string,
): Promise<void> {
  await tx.loginSession.updateMany({
    where: { id: actor.loginId, userId: actor.userId },
    data: { companyId },
  });
  await tx.$executeRaw`SELECT set_config('app.workspace_switch', 'on', true)`;
  await tx.$executeRaw`
    UPDATE "User" AS u SET "companyId" = m."companyId", "role" = m."role"
    FROM "Membership" AS m
    WHERE u."id" = ${actor.userId} AND m."userId" = u."id" AND m."companyId" = ${companyId}`;
  await tx.$executeRaw`SELECT set_config('app.workspace_switch', 'off', true)`;
}

/**
 * Whether the user belongs to a workspace other than this tenant
 * transaction's. RLS hides other companies' memberships, so a database
 * function answers this one question for it.
 */
export async function belongsElsewhere(tx: TenantTx, userId: string): Promise<boolean> {
  const [row] = await tx.$queryRaw<{ elsewhere: boolean }[]>`SELECT belongs_elsewhere(${userId}) AS elsewhere`;
  return row?.elsewhere ?? false;
}

export interface SwitchedWorkspace {
  companyId: string;
  name: string;
}

/**
 * Opens another of the user's workspaces in this sign-in. Recorded in the
 * workspace being entered, with the sign-in events: entering is access.
 */
export async function switchWorkspace(actor: WorkspaceActor, companyId: string): Promise<SwitchedWorkspace> {
  return db.$transaction(async (tx) => {
    const [login, membership] = await Promise.all([
      tx.loginSession.findFirst({
        where: { id: actor.loginId, userId: actor.userId, revokedAt: null },
        select: { ssoCompanyId: true },
      }),
      tx.membership.findUnique({
        where: { userId_companyId: { userId: actor.userId, companyId } },
        select: { role: true, company: { select: { name: true, ssoEnforced: true } } },
      }),
    ]);
    if (!login) throw new NotFoundError("Your session has ended. Log in again to continue.");
    if (!membership) throw new NotFoundError("You're not a member of that workspace.");
    const access = { companyId, role: membership.role, ssoEnforced: membership.company.ssoEnforced };
    if (!signInMayOpen(access, login.ssoCompanyId)) {
      throw new ForbiddenError(
        `${membership.company.name} requires single sign-on. Log in with SSO to open it.`,
      );
    }

    await openWorkspace(tx, actor, companyId);
    await logActivity(
      {
        companyId,
        actorId: actor.userId,
        action: "auth.workspace_switch",
        entityType: "user",
        entityId: actor.userId,
        summary: "switched to this workspace",
        metadata: { loginId: actor.loginId },
      },
      tx,
    );
    return { companyId, name: membership.company.name };
  });
}

export interface CreatedWorkspace {
  id: string;
  name: string;
  slug: string;
}

/** Starts a new company with the user as its owner, and opens it in this sign-in. */
export async function createWorkspace(actor: WorkspaceActor, name: string): Promise<CreatedWorkspace> {
  const limited = await rateLimit(`company:create:${actor.userId}`, COMPANY_CREATE_LIMIT);
  if (!limited.allowed) {
    throw new DomainError(
      `You've created several workspaces recently. Try again in ${retryMessage(limited.retryAfterSeconds)}.`,
    );
  }

  return withUniqueCompanySlug(name, (slug) =>
    db.$transaction(async (tx) => {
      const company = await tx.company.create({ data: { name, slug }, select: { id: true, name: true, slug: true } });
      await tx.membership.create({ data: { userId: actor.userId, companyId: company.id, role: "OWNER" } });
      await openWorkspace(tx, actor, company.id);
      await logActivity(
        {
          companyId: company.id,
          actorId: actor.userId,
          action: "company.create",
          entityType: "user",
          entityId: actor.userId,
          summary: `created ${company.name}`,
        },
        tx,
      );
      return company;
    }),
  );
}

export interface JoinedWorkspace {
  companyId: string;
  /** False when the company requires single sign-on this sign-in didn't come through. */
  opened: boolean;
}

const INVALID_INVITE = "This invite is no longer valid.";

/**
 * Accepts an invite addressed to the signed-in user, adding the workspace to
 * the ones they already belong to and opening it in this sign-in, unless it
 * requires single sign-on from its own identity provider.
 */
export async function acceptInvite(
  actor: WorkspaceActor & { email: string; name: string },
  inviteId: string,
): Promise<JoinedWorkspace> {
  const invite = await db.companyInvite.findUnique({
    where: { id: inviteId },
    select: { id: true, email: true, role: true, companyId: true, acceptedAt: true, expiresAt: true },
  });
  if (!invite || invite.acceptedAt !== null || invite.expiresAt < new Date()) {
    throw new DomainError(INVALID_INVITE);
  }
  if (invite.email.toLowerCase() !== actor.email.toLowerCase()) {
    throw new DomainError("This invite was sent to a different email address.");
  }

  return db.$transaction(async (tx) => {
    if (!(await claimInvite(tx, invite.id))) throw new DomainError(INVALID_INVITE);
    const [company, existing, login] = await Promise.all([
      tx.company.findUniqueOrThrow({ where: { id: invite.companyId }, select: { name: true, ssoEnforced: true } }),
      tx.membership.findUnique({
        where: { userId_companyId: { userId: actor.userId, companyId: invite.companyId } },
        select: { id: true },
      }),
      tx.loginSession.findFirst({ where: { id: actor.loginId, userId: actor.userId }, select: { ssoCompanyId: true } }),
    ]);
    if (existing) throw new ConflictError(`You're already a member of ${company.name}.`);

    await assertSeatAvailable(tx, invite.companyId, { countPendingInvites: false });
    await tx.membership.create({ data: { userId: actor.userId, companyId: invite.companyId, role: invite.role } });
    const access = { companyId: invite.companyId, role: invite.role, ssoEnforced: company.ssoEnforced };
    const opened = signInMayOpen(access, login?.ssoCompanyId ?? null);
    if (opened) await openWorkspace(tx, actor, invite.companyId);
    await logActivity(
      {
        companyId: invite.companyId,
        actorId: actor.userId,
        action: "user.join",
        entityType: "user",
        entityId: actor.userId,
        summary: `${actor.name} joined the company`,
      },
      tx,
    );
    return { companyId: invite.companyId, opened };
  });
}
