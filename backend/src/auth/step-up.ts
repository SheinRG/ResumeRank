import { db } from "../db";
import { rateLimit, REAUTH_PASSWORD_LIMIT, retryMessage } from "../rate-limit";
import { DomainError } from "../services/errors";
import type { ReauthInput } from "../validators/step-up";
import { logAuthEvent } from "./audit";
import { verifyTotpChallenge } from "./mfa/authenticator-app";
import { verifyPasskeyChallenge } from "./mfa/passkeys";
import { verifyPassword } from "./password";

/**
 * How long a sign-in, or a re-proof inside one, counts as recent. Sensitive
 * actions need a recent one, so a session left open on a shared machine, or
 * a stolen cookie, can't mint API keys or switch off security settings.
 */
export const STEP_UP_WINDOW_MINUTES = 10;

const METHOD_LABELS: Record<ReauthInput["method"], string> = {
  password: "their password",
  totp: "an authenticator app code",
  passkey: "a passkey",
};

/** When this sign-in last proved who it is: signing in, or the latest step-up. */
export function authenticatedAt(login: { createdAt: Date; reauthenticatedAt: Date | null }): Date {
  return login.reauthenticatedAt && login.reauthenticatedAt > login.createdAt ? login.reauthenticatedAt : login.createdAt;
}

export function isRecentlyAuthenticated(at: Date, now = new Date()): boolean {
  return now.getTime() - at.getTime() < STEP_UP_WINDOW_MINUTES * 60_000;
}

/** What this account can re-prove itself with. None means signing in again (SSO or Google without a second factor). */
export interface ReauthMethods {
  password: boolean;
  totp: boolean;
  passkey: boolean;
}

export async function reauthMethods(userId: string): Promise<ReauthMethods> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      passwordHash: true,
      totpFactor: { select: { confirmedAt: true } },
      _count: { select: { webAuthnCredentials: true } },
    },
  });
  return {
    password: Boolean(user?.passwordHash),
    totp: Boolean(user?.totpFactor?.confirmedAt),
    passkey: (user?._count.webAuthnCredentials ?? 0) > 0,
  };
}

/** The sign-in being re-proved: the user's own id, and the LoginSession it marks. */
export interface StepUpActor {
  userId: string;
  companyId: string | null;
  loginId: string;
}

async function checkPassword(actor: StepUpActor, password: string): Promise<void> {
  const limited = await rateLimit(`reauth-password:${actor.userId}`, REAUTH_PASSWORD_LIMIT);
  if (!limited.allowed) {
    throw new DomainError(`Too many attempts. Try again in ${retryMessage(limited.retryAfterSeconds)}.`);
  }
  const user = await db.user.findUnique({ where: { id: actor.userId }, select: { passwordHash: true } });
  if (!user?.passwordHash) throw new DomainError("Your account has no password. Use another method.");
  if (!(await verifyPassword(password, user.passwordHash))) {
    await logAuthEvent({
      userId: actor.userId,
      action: "auth.reauth_failed",
      summary: "entered a wrong password when confirming it was them",
      metadata: { method: "password", loginId: actor.loginId },
    });
    throw new DomainError("That password isn't right.", { password: ["That password isn't right"] });
  }
}

/**
 * Re-proves the sign-in with a password, an authenticator code or a passkey,
 * and restarts its step-up window. The second-factor checks are the sign-in
 * ones, so their attempt limits, single-use codes and audit entries apply.
 */
export async function reauthenticate(actor: StepUpActor, input: ReauthInput, now = new Date()): Promise<Date> {
  if (input.method === "password") await checkPassword(actor, input.password);
  else if (input.method === "totp") await verifyTotpChallenge(actor, input.code);
  else await verifyPasskeyChallenge(actor, { response: input.response });

  const { count } = await db.loginSession.updateMany({
    where: { id: actor.loginId, userId: actor.userId, revokedAt: null },
    data: { reauthenticatedAt: now },
  });
  if (count === 0) throw new DomainError("Your session has ended. Log in again to continue.");

  await logAuthEvent({
    userId: actor.userId,
    action: "auth.reauthenticated",
    summary: `confirmed it was them with ${METHOD_LABELS[input.method]}`,
    metadata: { method: input.method, loginId: actor.loginId },
  });
  return now;
}
