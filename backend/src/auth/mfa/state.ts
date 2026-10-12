import { db } from "../../db";
import { logActivity } from "../../activity";
import type { Prisma } from "../../generated/prisma/client";
import { MFA_ATTEMPT_LIMIT, rateLimit, retryMessage } from "../../rate-limit";
import { ConflictError, DomainError } from "../../services/errors";
import { generateRecoveryCodes, hashRecoveryCode } from "./recovery-codes";

/**
 * The person managing their own second factors. MFA belongs to the user, not
 * the workspace (someone mid-onboarding has no company yet), so these
 * functions take the user's own id; `companyId` only scopes the audit entry.
 */
export interface MfaActor {
  userId: string;
  companyId: string | null;
}

/** What a session needs to mark itself verified: the epoch it proved a factor against. */
export interface MfaVerified {
  epoch: number;
}

export interface FactorAdded extends MfaVerified {
  /** Shown once, when this was the user's first factor; stored only as hashes. */
  recoveryCodes: string[] | null;
}

export async function assertMfaAttemptAllowed(userId: string): Promise<void> {
  const limited = await rateLimit(`mfa:attempt:${userId}`, MFA_ATTEMPT_LIMIT);
  if (!limited.allowed) {
    throw new DomainError(`Too many attempts. Try again in ${retryMessage(limited.retryAfterSeconds)}.`);
  }
}

export async function logMfaActivity(
  tx: Prisma.TransactionClient,
  actor: MfaActor,
  action: string,
  summary: string,
  metadata?: Prisma.InputJsonValue,
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
      ...(metadata === undefined ? {} : { metadata }),
    },
    tx,
  );
}

export type MfaChallengeMethod = "totp" | "passkey" | "recovery_code";

const CHALLENGE_METHOD_LABELS: Record<MfaChallengeMethod, string> = {
  totp: "an authenticator app code",
  passkey: "a passkey",
  recovery_code: "a recovery code",
};

/**
 * Runs a sign-in factor check and records the outcome in the audit trail. A
 * failure is written on its own, since the check's transaction rolled back;
 * a recovery code records its success inside its own transaction. Call it
 * after the attempt limit, so attempts past the limit don't fill the trail.
 */
export async function auditMfaChallenge<T>(
  actor: MfaActor,
  method: MfaChallengeMethod,
  check: () => Promise<T>,
): Promise<T> {
  const label = CHALLENGE_METHOD_LABELS[method];
  let result: T;
  try {
    result = await check();
  } catch (error) {
    if (error instanceof DomainError) {
      await logMfaActivity(db, actor, "auth.mfa_failed", `failed a two-factor check with ${label}`, {
        method,
        reason: error.message,
      });
    }
    throw error;
  }
  if (method !== "recovery_code") {
    await logMfaActivity(db, actor, "auth.mfa_passed", `passed a two-factor check with ${label}`, { method });
  }
  return result;
}

export async function replaceRecoveryCodes(tx: Prisma.TransactionClient, userId: string): Promise<string[]> {
  const codes = generateRecoveryCodes();
  await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
  await tx.mfaRecoveryCode.createMany({
    data: codes.map((code) => ({ userId, codeHash: hashRecoveryCode(code) })),
  });
  return codes;
}

/**
 * Call after inserting or confirming a factor, in the same transaction. The
 * first factor turns MFA on: it starts a new epoch and issues recovery codes.
 */
export async function factorAdded(tx: Prisma.TransactionClient, userId: string): Promise<FactorAdded> {
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { mfaEnabledAt: true } });
  if (user.mfaEnabledAt) return { epoch: user.mfaEnabledAt.getTime(), recoveryCodes: null };

  const enabledAt = new Date();
  // Conditional, so two first factors confirmed at once can't both start an epoch.
  const { count } = await tx.user.updateMany({
    where: { id: userId, mfaEnabledAt: null },
    data: { mfaEnabledAt: enabledAt },
  });
  if (count === 0) throw new ConflictError("Your two-factor settings just changed. Reload and try again.");
  const recoveryCodes = await replaceRecoveryCodes(tx, userId);
  return { epoch: enabledAt.getTime(), recoveryCodes };
}

async function factorCount(client: Prisma.TransactionClient, userId: string): Promise<number> {
  const [totp, passkeys] = await Promise.all([
    client.totpFactor.count({ where: { userId, confirmedAt: { not: null } } }),
    client.webAuthnCredential.count({ where: { userId } }),
  ]);
  return totp + passkeys;
}

/**
 * Call after deleting a factor, in the same transaction. Removing the last
 * one turns MFA off, unless the company requires it — then the deletion is
 * refused (and rolled back) so nobody strands themselves on the setup page.
 */
export async function factorRemoved(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<{ enabledAt: Date | null }> {
  const user = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: { mfaEnabledAt: true, company: { select: { mfaRequired: true } } },
  });
  if ((await factorCount(tx, userId)) > 0) return { enabledAt: user.mfaEnabledAt };

  if (user.company?.mfaRequired) {
    throw new ConflictError(
      "Your workspace requires two-factor authentication. Add another method before removing this one.",
    );
  }
  await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
  await tx.user.update({ where: { id: userId }, data: { mfaEnabledAt: null } });
  return { enabledAt: null };
}

/** The user's current epoch, for a check that passed; refuses if MFA was turned off meanwhile. */
export async function currentEpoch(
  userId: string,
  client: Pick<Prisma.TransactionClient, "user"> = db,
): Promise<MfaVerified> {
  const user = await client.user.findUnique({ where: { id: userId }, select: { mfaEnabledAt: true } });
  if (!user?.mfaEnabledAt) {
    throw new ConflictError("Two-factor authentication is no longer on for your account. Reload the page.");
  }
  return { epoch: user.mfaEnabledAt.getTime() };
}
