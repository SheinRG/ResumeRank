import { db } from "../../db";
import { log } from "../../observability/log";
import { isPrismaError } from "../../services/prisma-errors";
import { ConflictError, DomainError, NotFoundError } from "../../services/errors";
import type { ConfirmTotpInput } from "../../validators/mfa";
import { openTotpSecret, sealTotpSecret } from "./secrets";
import {
  assertMfaAttemptAllowed,
  auditMfaChallenge,
  currentEpoch,
  factorAdded,
  factorRemoved,
  logMfaActivity,
  type FactorAdded,
  type MfaActor,
  type MfaVerified,
} from "./state";
import { base32, generateTotpSecret, matchTotp, totpUri } from "./totp";

const ISSUER = "ResumeRank";

const WRONG_CODE = "That code didn't match. Check that your phone's clock is set automatically, then try the newest code.";

export interface TotpEnrollment {
  /** Base32, for typing into an app that can't scan the QR code. */
  secret: string;
  uri: string;
}

/**
 * Stores a fresh, unconfirmed secret; it becomes a factor only once a code
 * from it is entered. Starting again replaces an unconfirmed secret, never a
 * confirmed one.
 */
export async function beginTotpEnrollment(actor: MfaActor): Promise<TotpEnrollment> {
  const user = await db.user.findUnique({ where: { id: actor.userId }, select: { email: true } });
  if (!user) throw new NotFoundError("Your account no longer exists.");

  const secret = generateTotpSecret();
  const data = { secret: sealTotpSecret(secret, actor.userId), lastUsedStep: null, createdAt: new Date() };
  const { count } = await db.totpFactor.updateMany({
    where: { userId: actor.userId, confirmedAt: null },
    data,
  });
  if (count === 0) {
    try {
      await db.totpFactor.create({ data: { userId: actor.userId, ...data } });
    } catch (error) {
      if (isPrismaError(error, "P2002")) {
        throw new ConflictError("An authenticator app is already set up. Remove it first to switch apps.");
      }
      throw error;
    }
  }
  return { secret: base32(secret), uri: totpUri({ secret, issuer: ISSUER, account: user.email }) };
}

/** Proves the app was set up correctly before it can be used to sign in. */
export async function confirmTotpEnrollment(
  actor: MfaActor,
  input: ConfirmTotpInput,
  now = Date.now(),
): Promise<FactorAdded> {
  await assertMfaAttemptAllowed(actor.userId);

  return db.$transaction(async (tx) => {
    const factor = await tx.totpFactor.findUnique({ where: { userId: actor.userId } });
    if (!factor || factor.confirmedAt) {
      throw new ConflictError("Start setting up your authenticator app again.");
    }
    const secret = openTotpSecret(factor.secret, actor.userId);
    if (!secret) throw new ConflictError("Start setting up your authenticator app again.");

    const step = matchTotp(secret, input.code, now, null);
    if (step === null) throw new DomainError(WRONG_CODE, { code: ["That code didn't match"] });

    const { count } = await tx.totpFactor.updateMany({
      where: { userId: actor.userId, confirmedAt: null },
      data: { confirmedAt: new Date(now), lastUsedStep: step },
    });
    if (count === 0) throw new ConflictError("Your authenticator app is already set up.");

    const added = await factorAdded(tx, actor.userId);
    await logMfaActivity(tx, actor, "mfa.totp_added", "set up an authenticator app for two-factor sign-in", {
      firstFactor: added.recoveryCodes !== null,
    });
    return added;
  });
}

export async function removeTotp(actor: MfaActor): Promise<{ enabledAt: Date | null }> {
  return db.$transaction(async (tx) => {
    const { count } = await tx.totpFactor.deleteMany({
      where: { userId: actor.userId, confirmedAt: { not: null } },
    });
    if (count === 0) throw new NotFoundError("No authenticator app is set up.");

    const state = await factorRemoved(tx, actor.userId);
    await logMfaActivity(tx, actor, "mfa.totp_removed", "removed their authenticator app", {
      mfaStillOn: state.enabledAt !== null,
    });
    return state;
  });
}

/** The sign-in check. A code is accepted once: its time step is claimed atomically. */
export async function verifyTotpChallenge(
  actor: MfaActor,
  code: string,
  now = Date.now(),
): Promise<MfaVerified> {
  await assertMfaAttemptAllowed(actor.userId);

  return auditMfaChallenge(actor, "totp", async () => {
    const factor = await db.totpFactor.findUnique({ where: { userId: actor.userId } });
    if (!factor?.confirmedAt) {
      throw new DomainError("No authenticator app is set up. Use a passkey or a recovery code.");
    }
    const secret = openTotpSecret(factor.secret, actor.userId);
    if (!secret) {
      // Only a rotated MFA_ENCRYPTION_KEY / AUTH_SECRET gets here; the user can't fix it.
      log.error("mfa.totp_secret_unreadable", { userId: actor.userId });
      throw new DomainError("Your authenticator app can't be checked right now. Use a passkey or a recovery code.");
    }

    const step = matchTotp(secret, code, now, factor.lastUsedStep);
    if (step === null) throw new DomainError(WRONG_CODE, { code: ["That code didn't match"] });

    const { count } = await db.totpFactor.updateMany({
      where: {
        userId: actor.userId,
        confirmedAt: { not: null },
        OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: step } }],
      },
      data: { lastUsedStep: step },
    });
    if (count === 0) throw new DomainError(WRONG_CODE, { code: ["That code was already used"] });

    return currentEpoch(actor.userId);
  });
}
