import { db } from "../db";
import { logActivity } from "../activity";
import type { Prisma } from "../generated/prisma/client";
import type { SignInMethod } from "../generated/prisma/enums";
import { ConflictError, NotFoundError } from "../services/errors";
import { logAuthEvent, signInMethodLabel } from "./audit";
import { describeDevice } from "./device";
import { signInLanding } from "./workspaces";
import {
  MAX_SESSION_MINUTES,
  sessionEnd,
  sessionExpiresAt,
  sessionPolicyOf,
} from "./session-policy";

/**
 * The person managing their own sessions. Sessions belong to the user, not
 * the workspace (someone mid-onboarding has no company yet), so these
 * functions take the user's own id; `companyId`, the workspace the request
 * runs in, only scopes the audit entry.
 */
export interface SessionActor {
  userId: string;
  companyId: string | null;
  /** The sign-in making the request, which the user ends by signing out instead. */
  loginId: string;
}

export interface NewLoginSession {
  id: string;
  userId: string;
  method: SignInMethod;
  userAgent: string | null;
  ipAddress: string | null;
  /** The company whose identity provider vouched for this sign-in, for SSO. */
  ssoCompanyId: string | null;
  /** A password sign-in whose password the current policy no longer accepts. */
  passwordChangeRequired?: boolean;
}

export interface LoginSessionSummary {
  id: string;
  method: SignInMethod;
  device: string;
  ipAddress: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  /** The workspace the session has open, if any. */
  workspace: string | null;
  current: boolean;
}

const USER_AGENT_MAX_LENGTH = 512;

/** Either transaction client: the owner's, or a tenant transaction's (RLS-scoped). */
interface SessionWriter {
  loginSession: {
    updateMany(args: Prisma.LoginSessionUpdateManyArgs): PromiseLike<Prisma.BatchPayload>;
  };
}

/**
 * Records a sign-in, opening it in the workspace it lands in (see
 * `landingWorkspace`). The user's dead rows are cleared on the way, so the
 * table stays small without a sweeper: a revoked row has done its job, and
 * one unseen for longer than any policy allows can never be live again.
 */
export async function startLoginSession(session: NewLoginSession, now = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - MAX_SESSION_MINUTES * 60_000);
  const device = describeDevice(session.userAgent);
  await db.$transaction(async (tx) => {
    await tx.loginSession.deleteMany({
      where: {
        userId: session.userId,
        OR: [{ revokedAt: { not: null } }, { createdAt: { lt: cutoff } }],
      },
    });
    const companyId = await signInLanding(tx, session.userId, session.ssoCompanyId);
    await tx.loginSession.create({
      data: { ...session, companyId, userAgent: session.userAgent?.slice(0, USER_AGENT_MAX_LENGTH) ?? null },
    });
    await logAuthEvent(
      {
        userId: session.userId,
        action: "auth.sign_in",
        summary: `signed in with ${signInMethodLabel(session.method)} on ${device}`,
        metadata: { method: session.method, device, ipAddress: session.ipAddress, loginId: session.id },
      },
      tx,
    );
  });
}

/** Conditional, so a request racing a revocation can't bring the session back. */
export async function touchLoginSession(id: string, now = new Date()): Promise<void> {
  await db.loginSession.updateMany({ where: { id, revokedAt: null }, data: { lastSeenAt: now } });
}

/** For signing out: the token is about to be deleted, and its row goes with it. */
export async function endLoginSession(id: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const [ended] = await tx.loginSession.updateManyAndReturn({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
      select: { userId: true, userAgent: true },
    });
    if (!ended) return;
    const device = describeDevice(ended.userAgent);
    await logAuthEvent(
      {
        userId: ended.userId,
        action: "auth.sign_out",
        summary: `signed out on ${device}`,
        metadata: { device, loginId: id },
      },
      tx,
    );
  });
}

/**
 * Revokes a user's sessions, all of them or all but `keep`. Call it wherever
 * `sessionVersion` is bumped, in the same transaction, so the sessions list
 * matches what the guards enforce. In a tenant transaction, call it before
 * anything moves the user out of the company: RLS hides their rows after.
 */
export async function revokeUserSessions(
  tx: SessionWriter,
  userId: string,
  keep?: string,
): Promise<number> {
  const { count } = await tx.loginSession.updateMany({
    where: { userId, revokedAt: null, ...(keep ? { id: { not: keep } } : {}) },
    data: { revokedAt: new Date() },
  });
  return count;
}

/**
 * Ends the user's sign-ins that have this workspace open, for when they
 * leave it; sign-ins in their other workspaces carry on. In a tenant
 * transaction, call it before the membership goes: RLS hides their rows after.
 */
export async function revokeWorkspaceSessions(
  tx: SessionWriter,
  userId: string,
  companyId: string,
): Promise<number> {
  const { count } = await tx.loginSession.updateMany({
    where: { userId, companyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return count;
}

/**
 * The user's live sessions, the current one first, then the most recently
 * active. Each is judged by the policy of the workspace it has open.
 */
export async function listLoginSessions(
  userId: string,
  currentId: string,
  now = Date.now(),
): Promise<LoginSessionSummary[]> {
  const sessions = await db.loginSession.findMany({
    where: { userId, revokedAt: null },
    orderBy: { lastSeenAt: "desc" },
    include: {
      company: { select: { name: true, sessionLifetimeMinutes: true, sessionIdleMinutes: true } },
    },
  });

  return sessions
    .filter((session) => sessionEnd(session, sessionPolicyOf(session.company), now) === null)
    .map((session) => ({
      id: session.id,
      method: session.method,
      device: describeDevice(session.userAgent),
      ipAddress: session.ipAddress,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
      expiresAt: sessionExpiresAt(session, sessionPolicyOf(session.company)),
      workspace: session.company?.name ?? null,
      current: session.id === currentId,
    }))
    .sort((a, b) => Number(b.current) - Number(a.current));
}

async function logSessionActivity(
  tx: Prisma.TransactionClient,
  actor: SessionActor,
  action: string,
  summary: string,
  metadata: Prisma.InputJsonValue,
): Promise<void> {
  // Someone mid-onboarding has no workspace whose audit trail this belongs to.
  if (!actor.companyId) return;
  await logActivity(
    {
      companyId: actor.companyId,
      actorId: actor.userId,
      action,
      entityType: "user",
      entityId: actor.userId,
      summary,
      metadata,
    },
    tx,
  );
}

/** Ends one of the user's other sessions; it's turned away on its next request. */
export async function revokeLoginSession(
  actor: SessionActor,
  sessionId: string,
): Promise<{ id: string; revokedAt: Date }> {
  if (sessionId === actor.loginId) {
    throw new ConflictError("That's the session you're using. Sign out to end it.");
  }

  return db.$transaction(async (tx) => {
    const revokedAt = new Date();
    // Scoped by user, so another person's session id behaves as if it didn't exist.
    const { count } = await tx.loginSession.updateMany({
      where: { id: sessionId, userId: actor.userId, revokedAt: null },
      data: { revokedAt },
    });
    if (count === 0) throw new NotFoundError("That session has already ended.");
    const session = await tx.loginSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { userAgent: true, method: true },
    });
    const device = describeDevice(session.userAgent);
    await logSessionActivity(tx, actor, "session.revoke", `signed out a session on ${device}`, {
      device,
      method: session.method,
    });
    return { id: sessionId, revokedAt };
  });
}

/** Ends every session but the one making the request. */
export async function revokeOtherLoginSessions(actor: SessionActor): Promise<{ revoked: number }> {
  return db.$transaction(async (tx) => {
    const revoked = await revokeUserSessions(tx, actor.userId, actor.loginId);
    await logSessionActivity(tx, actor, "session.revoke_others", "signed out of their other sessions", {
      revoked,
    });
    return { revoked };
  });
}
