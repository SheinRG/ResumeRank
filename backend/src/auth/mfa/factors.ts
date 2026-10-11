import { db } from "../../db";
import { DomainError, NotFoundError } from "../../services/errors";
import { hashRecoveryCode } from "./recovery-codes";
import {
  assertMfaAttemptAllowed,
  currentEpoch,
  logMfaActivity,
  replaceRecoveryCodes,
  type MfaActor,
  type MfaVerified,
} from "./state";

export interface PasskeySummary {
  id: string;
  name: string;
  backedUp: boolean;
  createdAt: Date;
  lastUsedAt: Date | null;
}

export interface MfaStatus {
  enabledAt: Date | null;
  /** The company requires a second factor, so the last one can't be removed. */
  required: boolean;
  totpConfirmedAt: Date | null;
  passkeys: PasskeySummary[];
  recoveryCodesRemaining: number;
}

export async function getMfaStatus(userId: string): Promise<MfaStatus> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      mfaEnabledAt: true,
      company: { select: { mfaRequired: true } },
      totpFactor: { select: { confirmedAt: true } },
      webAuthnCredentials: {
        select: { id: true, name: true, backedUp: true, createdAt: true, lastUsedAt: true },
        orderBy: { createdAt: "asc" },
      },
      _count: { select: { mfaRecoveryCodes: { where: { usedAt: null } } } },
    },
  });
  if (!user) throw new NotFoundError("Your account no longer exists.");
  return {
    enabledAt: user.mfaEnabledAt,
    required: user.company?.mfaRequired ?? false,
    totpConfirmedAt: user.totpFactor?.confirmedAt ?? null,
    passkeys: user.webAuthnCredentials,
    recoveryCodesRemaining: user._count.mfaRecoveryCodes,
  };
}

/** Which methods the sign-in challenge can offer. */
export interface MfaMethods {
  totp: boolean;
  passkey: boolean;
  recoveryCodesRemaining: number;
}

export async function getMfaMethods(userId: string): Promise<MfaMethods> {
  const status = await getMfaStatus(userId);
  return {
    totp: status.totpConfirmedAt !== null,
    passkey: status.passkeys.length > 0,
    recoveryCodesRemaining: status.recoveryCodesRemaining,
  };
}

/** Voids every earlier code; only possible while MFA is on. */
export async function regenerateRecoveryCodes(actor: MfaActor): Promise<{ recoveryCodes: string[] }> {
  return db.$transaction(async (tx) => {
    await currentEpoch(actor.userId, tx);
    const recoveryCodes = await replaceRecoveryCodes(tx, actor.userId);
    await logMfaActivity(tx, actor, "mfa.recovery_codes_regenerated", "generated new two-factor recovery codes");
    return { recoveryCodes };
  });
}

/**
 * The sign-in check for someone without their usual factor. Each code works
 * once, and using one is audited: it is how an attacker holding a stolen code
 * list would get in.
 */
export async function verifyRecoveryCode(
  actor: MfaActor,
  code: string,
): Promise<MfaVerified & { remaining: number }> {
  await assertMfaAttemptAllowed(actor.userId);

  return db.$transaction(async (tx) => {
    const { count } = await tx.mfaRecoveryCode.updateMany({
      where: { userId: actor.userId, codeHash: hashRecoveryCode(code), usedAt: null },
      data: { usedAt: new Date() },
    });
    if (count === 0) {
      throw new DomainError("That recovery code isn't valid or was already used.", {
        code: ["That code isn't valid or was already used"],
      });
    }
    const verified = await currentEpoch(actor.userId, tx);
    const remaining = await tx.mfaRecoveryCode.count({ where: { userId: actor.userId, usedAt: null } });
    await logMfaActivity(tx, actor, "mfa.recovery_code_used", "signed in with a two-factor recovery code", {
      remaining,
    });
    return { ...verified, remaining };
  });
}
