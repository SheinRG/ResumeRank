/** How long a company lets a session live, set by an owner in Settings → Security. */
export interface SessionPolicy {
  /** Minutes from signing in until the session ends, however active it is. */
  lifetimeMinutes: number;
  /** Minutes without a request until the session ends. */
  idleMinutes: number;
}

const MINUTE_MS = 60_000;

export const MIN_SESSION_IDLE_MINUTES = 15;
export const MIN_SESSION_LIFETIME_MINUTES = 60;
/** Also the session cookie's lifetime: the policy can only end a session sooner. */
export const MAX_SESSION_MINUTES = 30 * 24 * 60;

/** For people without a company, and the column defaults for new companies. */
export const DEFAULT_SESSION_POLICY: SessionPolicy = {
  lifetimeMinutes: MAX_SESSION_MINUTES,
  idleMinutes: 7 * 24 * 60,
};

/**
 * How stale `lastSeenAt` may get before a request rewrites it. Far finer than
 * the shortest idle timeout, and it keeps the per-request check to a read on
 * almost every request.
 */
export const LAST_SEEN_RESOLUTION_MS = MINUTE_MS;

export interface SessionTimes {
  createdAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
}

export type SessionEnd = "revoked" | "expired" | "idle";

export function sessionPolicyOf(
  company: { sessionLifetimeMinutes: number; sessionIdleMinutes: number } | null,
): SessionPolicy {
  if (!company) return DEFAULT_SESSION_POLICY;
  return { lifetimeMinutes: company.sessionLifetimeMinutes, idleMinutes: company.sessionIdleMinutes };
}

/** When the session ends if nothing else happens: the sooner of its lifetime and idle limits. */
export function sessionExpiresAt(session: SessionTimes, policy: SessionPolicy): Date {
  const lifetimeEnd = session.createdAt.getTime() + policy.lifetimeMinutes * MINUTE_MS;
  const idleEnd = session.lastSeenAt.getTime() + policy.idleMinutes * MINUTE_MS;
  return new Date(Math.min(lifetimeEnd, idleEnd));
}

/**
 * Why a session has ended, or null while it's live. Judged against the
 * company's current policy rather than one stamped at sign-in, so shortening
 * the lifetime also ends sessions that are already older than the new limit.
 */
export function sessionEnd(session: SessionTimes, policy: SessionPolicy, now = Date.now()): SessionEnd | null {
  if (session.revokedAt) return "revoked";
  if (now >= session.createdAt.getTime() + policy.lifetimeMinutes * MINUTE_MS) return "expired";
  if (now >= session.lastSeenAt.getTime() + policy.idleMinutes * MINUTE_MS) return "idle";
  return null;
}

export function needsLastSeenUpdate(lastSeenAt: Date, now = Date.now()): boolean {
  return now - lastSeenAt.getTime() >= LAST_SEEN_RESOLUTION_MS;
}
