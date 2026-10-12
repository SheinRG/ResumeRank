import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/server";

import { db } from "../../db";
import { appOrigin } from "../../env";
import type { WebAuthnCeremony } from "../../generated/prisma/enums";
import { errorFields, log } from "../../observability/log";
import { isPrismaError } from "../../services/prisma-errors";
import { ConflictError, DomainError, NotFoundError } from "../../services/errors";
import type {
  FinishPasskeyRegistrationInput,
  PasskeyChallengeInput,
  PasskeyIdInput,
} from "../../validators/mfa";
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

// Re-exported so the frontend takes these from the version this module runs,
// not an older copy another package hoists to the root.
export type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON };

const RP_NAME = "ResumeRank";
const CEREMONY_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_PASSKEYS = 10;

const EXPIRED = "That passkey request expired. Try again.";

/** Passkeys are bound to the configured hostname, not whatever host the request came in on. */
function relyingParty(): { id: string; origin: string } {
  const origin = appOrigin();
  return { id: new URL(origin).hostname, origin };
}

async function storeChallenge(userId: string, ceremony: WebAuthnCeremony, challenge: string): Promise<void> {
  const expiresAt = new Date(Date.now() + CEREMONY_TIMEOUT_MS);
  await db.webAuthnChallenge.upsert({
    where: { userId_ceremony: { userId, ceremony } },
    create: { userId, ceremony, challenge, expiresAt },
    update: { challenge, expiresAt },
  });
}

/**
 * Deleted before the response is checked, so a challenge is spent by its
 * first answer whether or not that answer verifies.
 */
async function consumeChallenge(userId: string, ceremony: WebAuthnCeremony): Promise<string> {
  try {
    const row = await db.webAuthnChallenge.delete({ where: { userId_ceremony: { userId, ceremony } } });
    if (row.expiresAt.getTime() < Date.now()) throw new DomainError(EXPIRED);
    return row.challenge;
  } catch (error) {
    if (isPrismaError(error, "P2025")) throw new DomainError(EXPIRED);
    throw error;
  }
}

export async function beginPasskeyRegistration(actor: MfaActor): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const user = await db.user.findUnique({
    where: { id: actor.userId },
    select: {
      name: true,
      email: true,
      webAuthnCredentials: { select: { credentialId: true, transports: true } },
    },
  });
  if (!user) throw new NotFoundError("Your account no longer exists.");
  if (user.webAuthnCredentials.length >= MAX_PASSKEYS) {
    throw new ConflictError(`You can register up to ${MAX_PASSKEYS} passkeys. Remove one first.`);
  }

  const rp = relyingParty();
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rp.id,
    userName: user.email,
    userDisplayName: user.name,
    // The user handle is stored on the authenticator; an opaque id leaks nothing.
    userID: new TextEncoder().encode(actor.userId),
    timeout: CEREMONY_TIMEOUT_MS,
    attestationType: "none",
    excludeCredentials: user.webAuthnCredentials.map((credential) => ({
      id: credential.credentialId,
      transports: credential.transports,
    })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
  });
  await storeChallenge(actor.userId, "REGISTRATION", options.challenge);
  return options;
}

export async function finishPasskeyRegistration(
  actor: MfaActor,
  input: FinishPasskeyRegistrationInput,
): Promise<FactorAdded & { passkeyId: string }> {
  const expectedChallenge = await consumeChallenge(actor.userId, "REGISTRATION");
  const rp = relyingParty();

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      requireUserVerification: false,
    });
  } catch (error) {
    log.warn("mfa.passkey_registration_rejected", { userId: actor.userId, ...errorFields(error) });
    throw new DomainError("Your browser's passkey response couldn't be verified. Try again.");
  }
  if (!verification.verified) {
    throw new DomainError("Your browser's passkey response couldn't be verified. Try again.");
  }
  const { credential, credentialBackedUp } = verification.registrationInfo;

  try {
    return await db.$transaction(async (tx) => {
      const created = await tx.webAuthnCredential.create({
        data: {
          userId: actor.userId,
          credentialId: credential.id,
          publicKey: new Uint8Array(credential.publicKey),
          counter: BigInt(credential.counter),
          transports: credential.transports ?? [],
          name: input.name,
          backedUp: credentialBackedUp,
        },
        select: { id: true },
      });
      const added = await factorAdded(tx, actor.userId);
      await logMfaActivity(tx, actor, "mfa.passkey_added", `added the passkey "${input.name}"`, {
        firstFactor: added.recoveryCodes !== null,
      });
      return { ...added, passkeyId: created.id };
    });
  } catch (error) {
    if (isPrismaError(error, "P2002")) throw new ConflictError("That passkey is already registered.");
    throw error;
  }
}

export async function removePasskey(
  actor: MfaActor,
  input: PasskeyIdInput,
): Promise<{ id: string; enabledAt: Date | null }> {
  return db.$transaction(async (tx) => {
    const passkey = await tx.webAuthnCredential.findFirst({
      where: { id: input.passkeyId, userId: actor.userId },
      select: { id: true, name: true },
    });
    if (!passkey) throw new NotFoundError("That passkey no longer exists.");
    await tx.webAuthnCredential.delete({ where: { id: passkey.id } });

    const state = await factorRemoved(tx, actor.userId);
    await logMfaActivity(tx, actor, "mfa.passkey_removed", `removed the passkey "${passkey.name}"`, {
      mfaStillOn: state.enabledAt !== null,
    });
    return { id: passkey.id, ...state };
  });
}

export async function beginPasskeyChallenge(userId: string): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const credentials = await db.webAuthnCredential.findMany({
    where: { userId },
    select: { credentialId: true, transports: true },
  });
  if (credentials.length === 0) {
    throw new DomainError("No passkey is registered. Use your authenticator app or a recovery code.");
  }
  const options = await generateAuthenticationOptions({
    rpID: relyingParty().id,
    timeout: CEREMONY_TIMEOUT_MS,
    userVerification: "preferred",
    allowCredentials: credentials.map((credential) => ({
      id: credential.credentialId,
      transports: credential.transports,
    })),
  });
  await storeChallenge(userId, "AUTHENTICATION", options.challenge);
  return options;
}

/**
 * The sign-in check. The signature counter must move forward (unless the
 * authenticator doesn't keep one), which is how a cloned key shows itself.
 */
export async function verifyPasskeyChallenge(
  actor: MfaActor,
  input: PasskeyChallengeInput,
): Promise<MfaVerified> {
  await assertMfaAttemptAllowed(actor.userId);

  return auditMfaChallenge(actor, "passkey", async () => {
    const expectedChallenge = await consumeChallenge(actor.userId, "AUTHENTICATION");

    const stored = await db.webAuthnCredential.findFirst({
      where: { userId: actor.userId, credentialId: input.response.id },
    });
    if (!stored) throw new DomainError("That passkey isn't registered to your account.");

    const rp = relyingParty();
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: input.response,
        expectedChallenge,
        expectedOrigin: rp.origin,
        expectedRPID: rp.id,
        requireUserVerification: false,
        credential: {
          id: stored.credentialId,
          publicKey: new Uint8Array(stored.publicKey),
          counter: Number(stored.counter),
          transports: stored.transports,
        },
      });
    } catch (error) {
      log.warn("mfa.passkey_assertion_rejected", { userId: actor.userId, ...errorFields(error) });
      throw new DomainError("That passkey couldn't be verified. Try again.");
    }
    if (!verification.verified) throw new DomainError("That passkey couldn't be verified. Try again.");

    await db.webAuthnCredential.update({
      where: { id: stored.id },
      data: { counter: BigInt(verification.authenticationInfo.newCounter), lastUsedAt: new Date() },
    });
    return currentEpoch(actor.userId);
  });
}
