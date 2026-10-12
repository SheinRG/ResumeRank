import { db } from "../db";
import { logActivity } from "../activity";
import type { Prisma } from "../generated/prisma/client";
import type { SignInMethod } from "../generated/prisma/enums";
import { ConflictError, NotFoundError } from "../services/errors";
import { describeDevice } from "./device";
import {
  MAX_SESSION_MINUTES,
  sessionEnd,
  sessionExpiresAt,
  sessionPolicyOf,
} from "./session-policy";

/**
 * The person managing their own sessions. Sessions belong to the user, not
 * the workspace (someone mid-onboarding has no company yet), so these
 * functions take the user's own id; `companyId` only scopes the audit entry.
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
}

export interface LoginSessionSummary {
  id: string;
  method: SignInMethod;
  device: string;
  ipAddress: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
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
 * Records a sign-in. The user's dead rows are cleared on the way, so the
 * table stays small without a sweeper: a revoked row has done its job, and
 * one unseen for longer than any policy allows can never be live again.
 */
export async function startLoginSession(session: NewLoginSession, now = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - MAX_SESSION_MINUTES * 60_000);
  await db.$transaction([
    db.loginSession.deleteMany({
      where: {
        userId: session.userId,
        OR: [{ revokedAt: { not: null } }, { createdAt: { lt: cutoff } }],
      },
    }),
    db.loginSession.create({
      data: { ...session, userAgent: session.userAgent?.slice(0, USER_AGENT_MAX_LENGTH) ?? null },
    }),
  ]);
}

/** Conditional, so a request racing a revocation can't bring the session back. */
export async function touchLoginSession(id: string, now = new Date()): Promise<void> {
  await db.loginSession.updateMany({ where: { id, revokedAt: null }, data: { lastSeenAt: now } });
}

/** For signing out: the token is about to be deleted, and its row goes with it. */
export async function endLoginSession(id: string): Promise<void> {
  await db.loginSession.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
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

/** The user's live sessions, the current one first, then the most recently active. */
export async function listLoginSessions(
  userId: string,
  currentId: string,
  now = Date.now(),
): Promise<LoginSessionSummary[]> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      company: { select: { sessionLifetimeMinutes: true, sessionIdleMinutes: true } },
      loginSessions: { where: { revokedAt: null }, orderBy: { lastSeenAt: "desc" } },
    },
  });
  if (!user) throw new NotFoundError("Your account no longer exists.");
  const policy = sessionPolicyOf(user.company);

  return user.loginSessions
    .filter((session) => sessionEnd(session, policy, now) === null)
    .map((session) => ({
      id: session.id,
      method: session.method,
      device: describeDevice(session.userAgent),
      ipAddress: session.ipAddress,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
      expiresAt: sessionExpiresAt(session, policy),
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
