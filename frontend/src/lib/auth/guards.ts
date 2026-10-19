import { cookies, headers } from "next/headers";
import { decode } from "next-auth/jwt";
import { cache } from "react";

import { auth } from "@/lib/auth";
import { db } from "@resumerank/core/db";
import { env } from "@resumerank/core/env";
import { networkAllows } from "@resumerank/core/auth/ip-allowlist";
import { authenticatedAt, isRecentlyAuthenticated } from "@resumerank/core/auth/step-up";
import { can, canAdmin, type Permission } from "@resumerank/core/auth/roles";
import { mfaGate, type MfaGate } from "@resumerank/core/auth/mfa/policy";
import { needsLastSeenUpdate, sessionEnd, sessionPolicyOf } from "@resumerank/core/auth/session-policy";
import { touchLoginSession } from "@resumerank/core/auth/sessions";
import { resolveWorkspace, signInMayOpen } from "@resumerank/core/auth/workspace-policy";
import { staffMay, type StaffActor, type StaffRole } from "@resumerank/core/staff/actor";
import { activeSupportSession, type ActiveSupportSession } from "@resumerank/core/staff/support-sessions";
import { annotateLogContext } from "@resumerank/core/observability/log";
import { resolveFormatPrefs, type FormatPrefs } from "@resumerank/core/locale";
import { clientIp } from "@resumerank/core/request-ip";
import type { Role } from "@resumerank/core/validators/enums";
import type { TenantContext } from "@resumerank/core/services/context";

// Re-exported so UI affordances can keep importing capability checks from the
// guard module; the pure predicates live in the backend package where they are
// unit-tested.
export { can, canAdmin };

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

/** A live session on a network its workspace's IP allowlist doesn't include. */
export class NetworkBlockedError extends GateError {
  constructor() {
    super("Your company only allows access from its approved networks. Connect to one to continue.");
  }
}

/** A password sign-in whose password falls short of the current policy. */
export class PasswordChangeRequiredError extends GateError {
  constructor() {
    super("Your company's password policy has changed. Choose a new password to continue.");
  }
}

/**
 * A sensitive action from a sign-in that hasn't proved itself recently. Not a
 * dead session: the client catches it (`code: "reauth_required"`), asks the
 * person to confirm it's them, and retries.
 */
export class ReauthRequiredError extends GateError {
  constructor() {
    super("Confirm it's you to continue.");
  }
}

/** Every workspace the user belongs to has been suspended by ResumeRank. */
export class WorkspaceSuspendedError extends GateError {
  constructor() {
    super("Your workspace has been suspended. Contact ResumeRank support.");
  }
}

/**
 * Something a support session may not do: it is read-only, and it never
 * touches the account it views as (sign-ins, second factors, password),
 * nor exports in bulk.
 */
export class SupportSessionRestrictedError extends GateError {
  constructor() {
    super("That isn't available in a support session, which is read-only.");
  }
}

/** The staff console, for someone who isn't staff. Pages answer it with a 404. */
export class NotStaffError extends GateError {
  constructor() {
    super("That page doesn't exist.");
  }
}

/**
 * Staff who haven't proved their own second factor in this sign-in: they
 * have none, or came through single sign-on, whose IdP vouches only for its
 * own company's members.
 */
export class StaffSecondFactorError extends GateError {
  constructor() {
    super("The staff console needs your own second factor. Set one up, then sign in again with your password.");
  }
}

/** Where a page sends a session its guard turned away. */
export function gateRedirectPath(error: GateError): string {
  if (error instanceof MfaChallengeRequiredError) return "/mfa";
  if (error instanceof MfaSetupRequiredError) return "/mfa/setup";
  if (error instanceof PasswordChangeRequiredError) return "/password-change";
  if (error instanceof NetworkBlockedError) return "/network-blocked";
  if (error instanceof WorkspaceSuspendedError) return "/workspace-suspended";
  if (error instanceof SupportSessionRestrictedError) return "/dashboard";
  return "/session-ended";
}

/** A workspace the user belongs to, for the switcher. */
export interface WorkspaceOption {
  companyId: string;
  name: string;
  logoUrl: string | null;
  role: Role;
  /** Why this sign-in can't open it: ResumeRank suspended it, the company requires SSO it didn't come through, or blocks this network. */
  blockedBy: "suspended" | "sso" | "network" | null;
}

/** ResumeRank support viewing the workspace as this user, read-only (staff/support-sessions.ts). */
export interface SupportSessionView {
  id: string;
  staffName: string;
  reason: string;
  expiresAt: Date;
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
  /** How this person sees dates and numbers: their own choice, else the open workspace's. */
  format: FormatPrefs;
  /** What they chose themselves; null where they follow the workspace. */
  ownFormat: { locale: string | null; timeZone: string | null };
  /**
   * Set when this is a staff member's sign-in viewing as this user: everything
   * above is the member's, and nothing may be changed.
   */
  supportSession: SupportSessionView | null;
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

/** The staff role of the person actually signed in, whoever they're viewing as. */
export interface StaffIdentity {
  userId: string;
  email: string;
  name: string;
  role: StaffRole;
  /** This sign-in proved the account's own second factor; an identity provider's word isn't enough for staff. */
  secondFactorProven: boolean;
}

/** A signed-in session before its second-factor gate is applied. */
export interface SignedInSession {
  user: CurrentUser;
  /** This sign-in: the id of its LoginSession row, and what a second-factor proof is bound to. */
  loginId: string;
  mfa: MfaGate;
  /** Whether this sign-in must set a new password before it can do anything else. */
  passwordChange: boolean;
  /** When this sign-in last proved who it is: signing in, or a step-up since. */
  authenticatedAt: Date;
  /** Whether the open workspace's IP allowlist admits this request. */
  network: "allowed" | "blocked";
  /** The address the allowlist was judged on, shown to people it blocks. */
  clientIp: string;
  /** Null unless the person signed in is ResumeRank staff. */
  staff: StaffIdentity | null;
}

/**
 * Resolves the signed-in user fresh from the database once per request, so a
 * role demotion takes effect on the next request — the JWT is never the
 * authorization source of truth. A token whose session version is behind the
 * user's has been revoked and is rejected the same way, as is one whose
 * LoginSession row was revoked, went idle or outlived its workspace's session
 * lifetime, and one whose workspace requires single sign-on from its own
 * identity provider when this sign-in didn't come through it. The open
 * workspace's IP allowlist is judged here too, but reported rather than
 * thrown: getting back on an approved network is all it takes.
 *
 * The workspace is the one this sign-in has open (`LoginSession.companyId`)
 * while the user still belongs to it; after they leave it, wherever a new
 * sign-in would land. Role, policies and tenancy all follow from it.
 *
 * A staff member in a support session gets the member they view as instead
 * (`supportSessionUser`), once their own sign-in has passed every check
 * above, including their own second factor.
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
      locale: true,
      timeZone: true,
      staffMember: { select: { role: true } },
      memberships: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          role: true,
          companyId: true,
          company: {
            select: {
              name: true,
              logoUrl: true,
              locale: true,
              timeZone: true,
              ssoEnforced: true,
              mfaRequired: true,
              sessionLifetimeMinutes: true,
              sessionIdleMinutes: true,
              suspendedAt: true,
              ipAllowlist: { select: { cidr: true } },
            },
          },
        },
      },
      loginSessions: {
        where: { id: loginId },
        select: {
          createdAt: true,
          lastSeenAt: true,
          revokedAt: true,
          companyId: true,
          ssoCompanyId: true,
          passwordChangeRequired: true,
          reauthenticatedAt: true,
        },
      },
    },
  });
  if (!user) throw new GateError("Your account no longer exists.");
  const {
    sessionVersion,
    mfaEnabledAt,
    loginSessions,
    memberships,
    companyId: preferred,
    locale,
    timeZone,
    staffMember,
    ...rest
  } = user;
  if (sessionVersion !== session.sessionVersion) {
    throw new GateError(SESSION_ENDED);
  }
  const [login] = loginSessions;
  if (!login) throw new GateError(SESSION_ENDED);

  const ip = clientIp(await headers());
  const workspaces = memberships.map(({ role, companyId, company: { ipAllowlist, ...company } }) => ({
    ...company,
    role,
    companyId,
    suspended: company.suspendedAt !== null,
    ipRanges: ipAllowlist.map((range) => range.cidr),
  }));
  const ssoCompanyId = login.ssoCompanyId;
  const active = resolveWorkspace(workspaces, { opened: login.companyId, preferred, ssoCompanyId });
  annotateLogContext({ companyId: active?.companyId ?? null });
  if (sessionEnd(login, sessionPolicyOf(active)) !== null) {
    throw new GateError(SESSION_ENDED);
  }
  if (needsLastSeenUpdate(login.lastSeenAt)) await touchLoginSession(loginId);
  // A member everywhere, but in no workspace this sign-in may open.
  if (!active && workspaces.length > 0) {
    throw workspaces.every((workspace) => workspace.suspended) ? new WorkspaceSuspendedError() : new SsoRequiredError();
  }
  if (active && !signInMayOpen(active, ssoCompanyId)) throw new SsoRequiredError();

  const mfa = mfaGate({
    // The identity provider owns MFA only inside its own company.
    viaSso: ssoCompanyId !== null && (active === null || active.companyId === ssoCompanyId),
    enabledAt: mfaEnabledAt,
    verifiedEpoch: session.mfaEpoch,
    required: active?.mfaRequired ?? false,
  });
  const staff: StaffIdentity | null = staffMember
    ? {
        userId: id,
        email: rest.email,
        name: rest.name,
        role: staffMember.role,
        secondFactorProven: mfaEnabledAt !== null && session.mfaEpoch === mfaEnabledAt.getTime(),
      }
    : null;
  const signedIn: SignedInSession = {
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
        blockedBy: workspace.suspended
          ? "suspended"
          : !signInMayOpen(workspace, ssoCompanyId)
            ? "sso"
            : !networkAllows(workspace, ip)
              ? "network"
              : null,
      })),
      format: resolveFormatPrefs({ locale, timeZone }, active),
      ownFormat: { locale, timeZone },
      supportSession: null,
    },
    loginId,
    mfa,
    passwordChange: login.passwordChangeRequired,
    authenticatedAt: authenticatedAt(login),
    network: active && !networkAllows(active, ip) ? "blocked" : "allowed",
    clientIp: ip,
    staff,
  };

  if (!staff?.secondFactorProven || mfa !== "pass" || login.passwordChangeRequired) return signedIn;
  const support = await activeSupportSession(loginId, id);
  const viewed = support ? await supportSessionUser(support) : null;
  if (!support || !viewed) return signedIn;
  annotateLogContext({ supportSessionId: support.id, viewingAsUserId: support.targetUserId, companyId: support.companyId });
  // The workspace's allowlist and SSO rule are for its members: it chose to
  // let support in by granting access.
  return { ...signedIn, user: viewed, network: "allowed" };
});

/**
 * The member a support session views as, as the guards would resolve them in
 * that workspace, or null once they've left it (the session then lapses).
 */
async function supportSessionUser(support: ActiveSupportSession): Promise<CurrentUser | null> {
  const membership = await db.membership.findUnique({
    where: { userId_companyId: { userId: support.targetUserId, companyId: support.companyId } },
    select: {
      role: true,
      company: { select: { name: true, logoUrl: true, locale: true, timeZone: true } },
      user: {
        select: { id: true, name: true, email: true, emailVerified: true, image: true, locale: true, timeZone: true },
      },
    },
  });
  if (!membership) return null;
  const { role, company, user } = membership;
  const { locale, timeZone, ...person } = user;
  return {
    ...person,
    role,
    companyId: support.companyId,
    companyName: company.name,
    companyLogoUrl: company.logoUrl,
    workspaces: [{ companyId: support.companyId, name: company.name, logoUrl: company.logoUrl, role, blockedBy: null }],
    format: resolveFormatPrefs({ locale, timeZone }, company),
    ownFormat: { locale, timeZone },
    supportSession: {
      id: support.id,
      staffName: support.staffName,
      reason: support.reason,
      expiresAt: support.expiresAt,
    },
  };
}

/** A user plus the sign-in they're using. */
export interface UserSession {
  user: CurrentUser;
  loginId: string;
}

function assertSecondFactor(mfa: MfaGate): void {
  if (mfa === "challenge") throw new MfaChallengeRequiredError();
  if (mfa === "setup") throw new MfaSetupRequiredError();
}

/** For anything that acts on the account itself, which a support session never may. */
function assertOwnSession(user: CurrentUser): void {
  if (user.supportSession) throw new SupportSessionRestrictedError();
}

/**
 * For switching workspace: second factor proven, but the open workspace may
 * block this network, since moving to one that doesn't is the way out.
 */
export async function requireWorkspaceSwitch(): Promise<UserSession> {
  const { user, loginId, mfa } = await getSignedInSession();
  assertSecondFactor(mfa);
  assertOwnSession(user);
  return { user, loginId };
}

/**
 * For changing your own password: second factor proven, but a sign-in held
 * for a new password is admitted, since changing it is what releases it.
 */
export async function requirePasswordChange(): Promise<UserSession> {
  const { user, loginId, mfa } = await getSignedInSession();
  assertSecondFactor(mfa);
  assertOwnSession(user);
  return { user, loginId };
}

/** Live, any second factor proven, password within policy, on an allowed network. */
const requireLiveSession = cache(async (): Promise<SignedInSession> => {
  const signedIn = await getSignedInSession();
  assertSecondFactor(signedIn.mfa);
  if (signedIn.passwordChange) throw new PasswordChangeRequiredError();
  if (signedIn.network === "blocked") throw new NetworkBlockedError();
  return signedIn;
});

/** A fully signed-in session, for actions that act on the sign-in itself; never a support session. */
export const requireUserSession = cache(async (): Promise<UserSession> => {
  const { user, loginId } = await requireLiveSession();
  assertOwnSession(user);
  return { user, loginId };
});

/**
 * A fully signed-in user: session live and any second factor proven. In a
 * support session, the member being viewed as, flagged `supportSession`.
 */
export const requireUser = cache(async (): Promise<CurrentUser> => {
  const { user } = await requireLiveSession();
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
  assertOwnSession(user);
  return { user, loginId };
}

/**
 * For sensitive actions, after their usual guard: the sign-in must have
 * proved who it is within the step-up window (`auth/step-up.ts`).
 */
export async function requireRecentAuth(): Promise<void> {
  const { authenticatedAt: at, user } = await getSignedInSession();
  assertOwnSession(user);
  if (!isRecentlyAuthenticated(at)) throw new ReauthRequiredError();
}

/** Narrows to a user who has a company — onboarding must run before this passes. */
export async function requireMember(): Promise<CompanyUser> {
  const user = await requireUser();
  if (!user.companyId) {
    throw new GateError("Create or join a company first.");
  }
  return { ...user, companyId: user.companyId };
}

async function requireVerifiedMember(): Promise<CompanyUser> {
  const user = await requireMember();
  if (!user.emailVerified) {
    throw new GateError("Verify your email to make changes.");
  }
  return user;
}

/**
 * For work a hiring manager or interviewer may do too. The role check is
 * here; which jobs it may be done on is the service's, which sees the data.
 */
export async function requireCan(permission: Permission): Promise<CompanyUser> {
  const user = await requireVerifiedMember();
  if (!can(user.role, permission)) {
    throw new GateError("Your role doesn't allow that.");
  }
  return user;
}

export async function requireAdmin(): Promise<CompanyUser> {
  const user = await requireVerifiedMember();
  if (!canAdmin(user.role)) {
    throw new GateError("Only admins can do that.");
  }
  return user;
}

/** The service-layer view of a guarded user: only what tenancy and authorization need. */
export function tenantContext(user: CompanyUser): TenantContext {
  return {
    companyId: user.companyId,
    actorId: user.id,
    role: user.role,
    ...(user.supportSession ? { readOnly: true } : {}),
  };
}

/** A staff member in the console, plus the sign-in they're using. */
export interface StaffSession {
  actor: StaffActor;
  loginId: string;
}

/**
 * For the staff console (/staff). The person signed in must be staff with at
 * least `role`, on a live sign-in that proved their own second factor. It
 * acts as them even during a support session, so they can look things up
 * or end it. Their workspaces' policies don't apply here: the console isn't
 * one of them.
 *
 * `recentAuth` is staff's step-up, for anything that changes a workspace or
 * opens one: it needs a recent sign-in, which a support session can't renew
 * (it can't act on the account), so those wait until it ends.
 */
export async function requireStaffSession(
  role: StaffRole = "SUPPORT",
  { recentAuth = false }: { recentAuth?: boolean } = {},
): Promise<StaffSession> {
  const signedIn = await getSignedInSession();
  const { staff } = signedIn;
  if (!staff) throw new NotStaffError();
  assertSecondFactor(signedIn.mfa);
  if (!staff.secondFactorProven) throw new StaffSecondFactorError();
  if (signedIn.passwordChange) throw new PasswordChangeRequiredError();
  if (!staffMay(staff.role, role)) throw new GateError("Only staff admins can do that.");
  if (recentAuth) {
    if (signedIn.user.supportSession) throw new GateError("End your support session first.");
    if (!isRecentlyAuthenticated(signedIn.authenticatedAt)) throw new ReauthRequiredError();
  }
  return {
    actor: { userId: staff.userId, email: staff.email, name: staff.name, role: staff.role, ipAddress: signedIn.clientIp },
    loginId: signedIn.loginId,
  };
}

export async function requireStaff(
  role: StaffRole = "SUPPORT",
  options: { recentAuth?: boolean } = {},
): Promise<StaffActor> {
  return (await requireStaffSession(role, options)).actor;
}

/**
 * Whether this request comes from a sign-in in a support session. Cheaper
 * than the full guard, for the action runner, which refuses every action
 * but the staff console's own while one is live.
 */
export async function inSupportSession(): Promise<boolean> {
  const claims = await sessionClaims();
  if (!claims?.loginId) return false;
  return (await activeSupportSession(claims.loginId, claims.id)) !== null;
}
