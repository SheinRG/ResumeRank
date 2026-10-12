import { cookies, headers } from "next/headers";
import { decode } from "next-auth/jwt";
import { cache } from "react";

import { auth } from "@/lib/auth";
import { db } from "@resumerank/core/db";
import { env } from "@resumerank/core/env";
import { canAdmin, canWrite } from "@resumerank/core/auth/roles";
import { mfaGate, type MfaGate } from "@resumerank/core/auth/mfa/policy";
import { needsLastSeenUpdate, sessionEnd, sessionPolicyOf } from "@resumerank/core/auth/session-policy";
import { touchLoginSession } from "@resumerank/core/auth/sessions";
import { resolveWorkspace, signInMayOpen } from "@resumerank/core/auth/workspace-policy";
import { annotateLogContext } from "@resumerank/core/observability/log";
import type { Role } from "@resumerank/core/validators/enums";
import type { TenantContext } from "@resumerank/core/services/context";

// Re-exported so UI affordances can keep importing capability checks from the
// guard module; the pure predicates live in the backend package where they are
// unit-tested.
export { canAdmin, canWrite };

/** Raised by guards; the action runner converts it into a typed ActionResult. */
export class GateError extends Error {}

/** A live session that didn't come through SSO, in a company that now requires it. */
export class SsoRequiredError extends GateError {
  constructor() {
    super("Your company requires single sign-on. Log in with SSO to continue.");
  }
}

/** A live session that still owes its second factor. */
export class MfaChallengeRequiredError extends GateError {
  constructor() {
    super("Confirm it's you with your second factor to continue.");
  }
}

/** A live session whose company requires a second factor the user doesn't have yet. */
export class MfaSetupRequiredError extends GateError {
  constructor() {
    super("Your company requires two-factor authentication. Set it up to continue.");
  }
}

const SESSION_ENDED = "Your session has ended. Log in again to continue.";

/** Where a page sends a session its guard turned away. */
export function gateRedirectPath(error: GateError): string {
  if (error instanceof MfaChallengeRequiredError) return "/mfa";
  if (error instanceof MfaSetupRequiredError) return "/mfa/setup";
  return "/session-ended";
}

/** A workspace the user belongs to, for the switcher. */
export interface WorkspaceOption {
  companyId: string;
  name: string;
  logoUrl: string | null;
  role: Role;
  /** False when the company requires single sign-on this sign-in didn't come through. */
  openable: boolean;
}

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  /** The role in the open workspace. */
  role: Role;
  emailVerified: Date | null;
  image: string | null;
  /** The workspace this sign-in has open, if the user belongs to any. */
  companyId: string | null;
  companyName: string | null;
  companyLogoUrl: string | null;
  /** Every workspace the user belongs to, oldest first. */
  workspaces: WorkspaceOption[];
}

/** A signed-in user who has completed onboarding and belongs to a company. */
export interface CompanyUser extends CurrentUser {
  companyId: string;
}

/** What the guards read from the session token. */
interface SessionClaims {
  id: string;
  sessionVersion: number;
  loginId: string | null;
  mfaEpoch: number | null;
}

const SESSION_COOKIES = ["__Secure-authjs.session-token", "authjs.session-token"];

function requestCookie(header: string, name: string): string | undefined {
  const prefix = `${name}=`;
  return header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
}

/**
 * The token a server action re-issued during this request, if any. After an
 * action refreshes the session (a password change, a proven second factor),
 * Next.js re-renders the page in the same response, and `auth()` would still
 * read the request's original Cookie header — judging the render by the token
 * the action just replaced. `cookies()` already holds the new one.
 */
async function reissuedClaims(): Promise<SessionClaims | null> {
  const [jar, requestHeaders] = await Promise.all([cookies(), headers()]);
  const original = requestHeaders.get("cookie") ?? "";
  for (const name of SESSION_COOKIES) {
    const value = jar.get(name)?.value;
    if (!value || requestCookie(original, name) === value) continue;
    const token = await decode({ token: value, secret: env().AUTH_SECRET, salt: name });
    if (!token?.id) return null;
    return {
      id: token.id,
      sessionVersion: token.sessionVersion ?? 0,
      loginId: token.loginId ?? null,
      mfaEpoch: token.mfaEpoch ?? null,
    };
  }
  return null;
}

async function sessionClaims(): Promise<SessionClaims | null> {
  const reissued = await reissuedClaims();
  if (reissued) return reissued;
  const session = await auth();
  if (!session?.user?.id) return null;
  const { id, sessionVersion, loginId, mfaEpoch } = session.user;
  return { id, sessionVersion, loginId, mfaEpoch };
}

/** A signed-in session before its second-factor gate is applied. */
export interface SignedInSession {
  user: CurrentUser;
  /** This sign-in: the id of its LoginSession row, and what a second-factor proof is bound to. */
  loginId: string;
  mfa: MfaGate;
}

/**
 * Resolves the signed-in user fresh from the database once per request, so a
 * role demotion takes effect on the next request — the JWT is never the
 * authorization source of truth. A token whose session version is behind the
 * user's has been revoked and is rejected the same way, as is one whose
 * LoginSession row was revoked, went idle or outlived its workspace's session
 * lifetime, and one whose workspace requires single sign-on from its own
 * identity provider when this sign-in didn't come through it.
 *
 * The workspace is the one this sign-in has open (`LoginSession.companyId`)
 * while the user still belongs to it; after they leave it, wherever a new
 * sign-in would land. Role, policies and tenancy all follow from it.
 *
 * Memoized per render with React `cache()`: the layout, the page and every
 * query it calls share one session read and one user lookup. Server actions
 * and route handlers run outside a render, so there it simply runs each call.
 */
export const getSignedInSession = cache(async (): Promise<SignedInSession> => {
  const session = await sessionClaims();
  if (!session) throw new GateError("You need to sign in to do that.");
  const { id, loginId } = session;
  annotateLogContext({ userId: id });
  // Tokens issued before sign-ins were recorded have no row to check.
  if (!loginId) throw new GateError(SESSION_ENDED);

  const user = await db.user.findUnique({
    where: { id },
    select: {
      sessionVersion: true,
      mfaEnabledAt: true,
      id: true,
      name: true,
      email: true,
      emailVerified: true,
      image: true,
      companyId: true,
      memberships: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          role: true,
          companyId: true,
          company: {
            select: {
              name: true,
              logoUrl: true,
              ssoEnforced: true,
              mfaRequired: true,
              sessionLifetimeMinutes: true,
              sessionIdleMinutes: true,
            },
          },
        },
      },
      loginSessions: {
        where: { id: loginId },
        select: { createdAt: true, lastSeenAt: true, revokedAt: true, companyId: true, ssoCompanyId: true },
      },
    },
  });
  if (!user) throw new GateError("Your account no longer exists.");
  const { sessionVersion, mfaEnabledAt, loginSessions, memberships, companyId: preferred, ...rest } = user;
  if (sessionVersion !== session.sessionVersion) {
    throw new GateError(SESSION_ENDED);
  }
  const [login] = loginSessions;
  if (!login) throw new GateError(SESSION_ENDED);

  const workspaces = memberships.map(({ role, companyId, company }) => ({
    ...company,
    role,
    companyId,
  }));
  const ssoCompanyId = login.ssoCompanyId;
  const active = resolveWorkspace(workspaces, { opened: login.companyId, preferred, ssoCompanyId });
  annotateLogContext({ companyId: active?.companyId ?? null });
  if (sessionEnd(login, sessionPolicyOf(active)) !== null) {
    throw new GateError(SESSION_ENDED);
  }
  if (needsLastSeenUpdate(login.lastSeenAt)) await touchLoginSession(loginId);
  // A member everywhere, but in no workspace this sign-in may open.
  if (!active && workspaces.length > 0) throw new SsoRequiredError();
  if (active && !signInMayOpen(active, ssoCompanyId)) throw new SsoRequiredError();

  const mfa = mfaGate({
    // The identity provider owns MFA only inside its own company.
    viaSso: ssoCompanyId !== null && (active === null || active.companyId === ssoCompanyId),
    enabledAt: mfaEnabledAt,
    verifiedEpoch: session.mfaEpoch,
    required: active?.mfaRequired ?? false,
  });
  return {
    user: {
      ...rest,
      role: active?.role ?? "MEMBER",
      companyId: active?.companyId ?? null,
      companyName: active?.name ?? null,
      companyLogoUrl: active?.logoUrl ?? null,
      workspaces: workspaces.map((workspace) => ({
        companyId: workspace.companyId,
        name: workspace.name,
        logoUrl: workspace.logoUrl,
        role: workspace.role,
        openable: signInMayOpen(workspace, ssoCompanyId),
      })),
    },
    loginId,
    mfa,
  };
});

/** A user plus the sign-in they're using. */
export interface UserSession {
  user: CurrentUser;
  loginId: string;
}

/** A fully signed-in session (live, any second factor proven), for actions that act on the sign-in itself. */
export const requireUserSession = cache(async (): Promise<UserSession> => {
  const { user, loginId, mfa } = await getSignedInSession();
  if (mfa === "challenge") throw new MfaChallengeRequiredError();
  if (mfa === "setup") throw new MfaSetupRequiredError();
  return { user, loginId };
});

/** A fully signed-in user: session live and any second factor proven. */
export const requireUser = cache(async (): Promise<CurrentUser> => {
  const { user } = await requireUserSession();
  return user;
});

/** For the sign-in challenge: a live session that still owes its second factor. */
export async function requireMfaChallenge(): Promise<UserSession> {
  const { user, loginId, mfa } = await getSignedInSession();
  if (mfa !== "challenge") {
    throw new GateError("There's no two-factor check waiting for this session.");
  }
  return { user, loginId };
}

/**
 * For adding a factor: a fully signed-in session, or one held at setup.
 * Never one that still owes a challenge, or a password alone could add an
 * attacker's authenticator to an account that already has one.
 */
export async function requireMfaEnrollment(): Promise<UserSession> {
  const { user, loginId, mfa } = await getSignedInSession();
  if (mfa === "challenge") throw new MfaChallengeRequiredError();
  return { user, loginId };
}

/** Narrows to a user who has a company — onboarding must run before this passes. */
export async function requireMember(): Promise<CompanyUser> {
  const user = await requireUser();
  if (!user.companyId) {
    throw new GateError("Create or join a company first.");
  }
  return { ...user, companyId: user.companyId };
}

export async function requireWriter(): Promise<CompanyUser> {
  const user = await requireMember();
  if (!user.emailVerified) {
    throw new GateError("Verify your email to make changes.");
  }
  if (!canWrite(user.role)) {
    throw new GateError("Viewers have read-only access.");
  }
  return user;
}

export async function requireAdmin(): Promise<CompanyUser> {
  const user = await requireWriter();
  if (!canAdmin(user.role)) {
    throw new GateError("Only admins can do that.");
  }
  return user;
}

/** The service-layer view of a guarded user: only what tenancy and authorization need. */
export function tenantContext(user: CompanyUser): TenantContext {
  return { companyId: user.companyId, actorId: user.id, role: user.role };
}
