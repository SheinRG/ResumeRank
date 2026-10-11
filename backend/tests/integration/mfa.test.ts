import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import {
  beginTotpEnrollment,
  confirmTotpEnrollment,
  removeTotp,
  verifyTotpChallenge,
} from "../../src/auth/mfa/authenticator-app";
import { getMfaStatus, regenerateRecoveryCodes, verifyRecoveryCode } from "../../src/auth/mfa/factors";
import {
  beginPasskeyChallenge,
  beginPasskeyRegistration,
  finishPasskeyRegistration,
  removePasskey,
  verifyPasskeyChallenge,
} from "../../src/auth/mfa/passkeys";
import { openTotpSecret } from "../../src/auth/mfa/secrets";
import type { MfaActor } from "../../src/auth/mfa/state";
import { hotp, timeStep, TOTP_PERIOD_SECONDS } from "../../src/auth/mfa/totp";
import { db } from "../../src/db";
import { appOrigin } from "../../src/env";
import type { TenantContext } from "../../src/services/context";
import { ConflictError, DomainError, ForbiddenError, NotFoundError } from "../../src/services/errors";
import { getMfaPolicy, resetMemberMfa, setMfaRequired } from "../../src/services/mfa";
import { closeSso } from "../../src/sso/jackson";
import { tenantTransaction } from "../../src/tenant-db";
import { SoftwareAuthenticator } from "./webauthn-authenticator";

const STEP_MS = TOTP_PERIOD_SECONDS * 1000;

interface Workspace {
  companyId: string;
  owner: TenantContext;
  admin: TenantContext;
  memberId: string;
}

const companyIds: string[] = [];
const userIds: string[] = [];

async function user(companyId: string | null, role: "OWNER" | "ADMIN" | "MEMBER" = "MEMBER"): Promise<string> {
  const tag = randomUUID().slice(0, 8);
  const created = await db.user.create({
    data: { name: `MFA ${role.toLowerCase()} ${tag}`, email: `mfa-${tag}@example.test`, role, companyId },
  });
  userIds.push(created.id);
  return created.id;
}

async function workspace(label: string): Promise<Workspace> {
  const tag = `${label}-${randomUUID().slice(0, 8)}`;
  const company = await db.company.create({ data: { name: `MFA ${tag}`, slug: `mfa-${tag}` } });
  companyIds.push(company.id);
  const [ownerId, adminId, memberId] = await Promise.all([
    user(company.id, "OWNER"),
    user(company.id, "ADMIN"),
    user(company.id, "MEMBER"),
  ]);
  return {
    companyId: company.id,
    owner: { companyId: company.id, actorId: ownerId, role: "OWNER" },
    admin: { companyId: company.id, actorId: adminId, role: "ADMIN" },
    memberId,
  };
}

function actor(userId: string, companyId: string | null): MfaActor {
  return { userId, companyId };
}

async function codeFor(userId: string, at: number): Promise<string> {
  const factor = await db.totpFactor.findUniqueOrThrow({ where: { userId } });
  const secret = openTotpSecret(factor.secret, userId);
  if (!secret) throw new Error("fixture secret did not open");
  return hotp(secret, timeStep(at));
}

/** Enrolls an authenticator app at `at` and returns the recovery codes it issued. */
async function enrollTotp(who: MfaActor, at = Date.now()): Promise<string[]> {
  await beginTotpEnrollment(who);
  const added = await confirmTotpEnrollment(who, { code: await codeFor(who.userId, at) }, at);
  return added.recoveryCodes ?? [];
}

async function currentState(userId: string): Promise<{ epoch: number | undefined }> {
  return { epoch: (await getMfaStatus(userId)).enabledAt?.getTime() };
}

function relyingParty(): { rpId: string; origin: string } {
  const origin = appOrigin();
  return { rpId: new URL(origin).hostname, origin };
}

async function registerPasskey(who: MfaActor, name = "Test key"): Promise<SoftwareAuthenticator> {
  const { rpId, origin } = relyingParty();
  const authenticator = new SoftwareAuthenticator(rpId, origin);
  const options = await beginPasskeyRegistration(who);
  await finishPasskeyRegistration(who, { name, response: authenticator.register(options.challenge) });
  return authenticator;
}

afterAll(async () => {
  await db.company.deleteMany({ where: { id: { in: companyIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.rateLimitCounter.deleteMany({ where: { key: { in: userIds.map((id) => `mfa:attempt:${id}`) } } });
  await closeSso();
  await db.$disconnect();
});

describe("authenticator app", () => {
  it("turns MFA on with the first confirmed code and issues recovery codes", async () => {
    const ws = await workspace("totp");
    const who = actor(ws.memberId, ws.companyId);

    const enrollment = await beginTotpEnrollment(who);
    expect(enrollment.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(enrollment.uri).toContain(`secret=${enrollment.secret}`);
    expect((await getMfaStatus(who.userId)).enabledAt).toBeNull();

    const now = Date.now();
    const added = await confirmTotpEnrollment(who, { code: await codeFor(who.userId, now) }, now);
    expect(added.recoveryCodes).toHaveLength(10);

    const status = await getMfaStatus(who.userId);
    expect(status.enabledAt?.getTime()).toBe(added.epoch);
    expect(status.totpConfirmedAt).not.toBeNull();
    expect(status.recoveryCodesRemaining).toBe(10);
    // Only hashes are stored.
    const stored = await db.mfaRecoveryCode.findMany({ where: { userId: who.userId } });
    expect(stored.map((row) => row.codeHash)).not.toContain(added.recoveryCodes?.[0]);

    const logged = await db.activityLog.findFirst({ where: { companyId: ws.companyId, action: "mfa.totp_added" } });
    expect(logged?.actorId).toBe(who.userId);
  });

  it("refuses a wrong code and leaves the secret unconfirmed", async () => {
    const who = actor(await user(null), null);
    await beginTotpEnrollment(who);
    const now = Date.now();
    const right = await codeFor(who.userId, now);
    const wrong = right === "000000" ? "111111" : "000000";

    await expect(confirmTotpEnrollment(who, { code: wrong }, now)).rejects.toThrow(DomainError);
    expect((await getMfaStatus(who.userId)).totpConfirmedAt).toBeNull();
    // Starting over issues a fresh secret, so the old code no longer fits.
    await beginTotpEnrollment(who);
    expect(await codeFor(who.userId, now)).not.toBe(right);
  });

  it("accepts each sign-in code once, and only near the current time", async () => {
    const who = actor(await user(null), null);
    const enrolledAt = Date.now();
    await enrollTotp(who, enrolledAt);

    // The enrollment code itself can't be replayed at sign-in.
    await expect(verifyTotpChallenge(who, await codeFor(who.userId, enrolledAt), enrolledAt)).rejects.toThrow(
      DomainError,
    );

    const later = enrolledAt + STEP_MS;
    const code = await codeFor(who.userId, later);
    const verified = await verifyTotpChallenge(who, code, later);
    expect(verified.epoch).toBe((await getMfaStatus(who.userId)).enabledAt?.getTime());
    await expect(verifyTotpChallenge(who, code, later)).rejects.toThrow(DomainError);

    const muchLater = later + 5 * STEP_MS;
    await expect(verifyTotpChallenge(who, await codeFor(who.userId, later + STEP_MS), muchLater)).rejects.toThrow(
      DomainError,
    );
  });

  it("can't be replaced while one is confirmed", async () => {
    const who = actor(await user(null), null);
    await enrollTotp(who);
    await expect(beginTotpEnrollment(who)).rejects.toThrow(ConflictError);
  });
});

describe("recovery codes", () => {
  it("work once each, and regenerating voids the earlier set", async () => {
    const ws = await workspace("recovery");
    const who = actor(ws.memberId, ws.companyId);
    const [first = "", second = ""] = await enrollTotp(who);

    const verified = await verifyRecoveryCode(who, first.toUpperCase());
    expect(verified.remaining).toBe(9);
    await expect(verifyRecoveryCode(who, first)).rejects.toThrow(DomainError);
    expect(
      await db.activityLog.count({ where: { companyId: ws.companyId, action: "mfa.recovery_code_used" } }),
    ).toBe(1);

    const { recoveryCodes } = await regenerateRecoveryCodes(who);
    expect(recoveryCodes).toHaveLength(10);
    await expect(verifyRecoveryCode(who, second)).rejects.toThrow(DomainError);
    expect((await verifyRecoveryCode(who, recoveryCodes[0] ?? "")).remaining).toBe(9);
  });

  it("can't be regenerated without MFA on", async () => {
    const who = actor(await user(null), null);
    await expect(regenerateRecoveryCodes(who)).rejects.toThrow(ConflictError);
  });
});

describe("passkeys", () => {
  it("register through the WebAuthn ceremony and verify a sign-in", async () => {
    const who = actor(await user(null), null);
    const authenticator = await registerPasskey(who, "Laptop");

    const status = await getMfaStatus(who.userId);
    expect(status.passkeys.map((passkey) => passkey.name)).toEqual(["Laptop"]);
    expect(status.enabledAt).not.toBeNull();
    expect(status.recoveryCodesRemaining).toBe(10);

    const options = await beginPasskeyChallenge(who.userId);
    const verified = await verifyPasskeyChallenge(who, { response: authenticator.assert(options.challenge) });
    expect(verified.epoch).toBe(status.enabledAt?.getTime());
    const stored = await db.webAuthnCredential.findFirstOrThrow({ where: { userId: who.userId } });
    expect(Number(stored.counter)).toBe(authenticator.counter);
    expect(stored.lastUsedAt).not.toBeNull();
  });

  it("spends a challenge on its first answer", async () => {
    const who = actor(await user(null), null);
    const authenticator = await registerPasskey(who);
    const options = await beginPasskeyChallenge(who.userId);
    const response = authenticator.assert(options.challenge);

    await verifyPasskeyChallenge(who, { response });
    await expect(verifyPasskeyChallenge(who, { response })).rejects.toThrow(DomainError);
  });

  it("rejects a signature counter that goes backwards, as a cloned key would send", async () => {
    const who = actor(await user(null), null);
    const authenticator = await registerPasskey(who);
    const first = await beginPasskeyChallenge(who.userId);
    await verifyPasskeyChallenge(who, { response: authenticator.assert(first.challenge, 5) });

    const second = await beginPasskeyChallenge(who.userId);
    await expect(
      verifyPasskeyChallenge(who, { response: authenticator.assert(second.challenge, 3) }),
    ).rejects.toThrow(DomainError);
  });

  it("refuses another user's passkey and a response to someone else's challenge", async () => {
    const alice = actor(await user(null), null);
    const bob = actor(await user(null), null);
    const alicesKey = await registerPasskey(alice);
    await registerPasskey(bob);

    const bobsChallenge = await beginPasskeyChallenge(bob.userId);
    await expect(
      verifyPasskeyChallenge(bob, { response: alicesKey.assert(bobsChallenge.challenge) }),
    ).rejects.toThrow(DomainError);

    // Alice's key signing over a challenge Alice was never issued.
    await beginPasskeyChallenge(alice.userId);
    await expect(
      verifyPasskeyChallenge(alice, { response: alicesKey.assert(bobsChallenge.challenge) }),
    ).rejects.toThrow(DomainError);
  });

  it("won't register the same authenticator twice", async () => {
    const who = actor(await user(null), null);
    const authenticator = await registerPasskey(who);
    const options = await beginPasskeyRegistration(who);
    expect(options.excludeCredentials?.map((credential) => credential.id)).toEqual([
      authenticator.credentialId.toString("base64url"),
    ]);
    await expect(
      finishPasskeyRegistration(who, { name: "Again", response: authenticator.register(options.challenge) }),
    ).rejects.toThrow(ConflictError);
  });
});

describe("removing factors", () => {
  it("keeps MFA on while another factor remains, and turns it off with the last", async () => {
    const who = actor(await user(null), null);
    await enrollTotp(who);
    await registerPasskey(who);
    const { epoch } = await currentState(who.userId);

    expect((await removeTotp(who)).enabledAt?.getTime()).toBe(epoch);
    const [passkey] = (await getMfaStatus(who.userId)).passkeys;
    const removed = await removePasskey(who, { passkeyId: passkey?.id ?? "" });
    expect(removed.enabledAt).toBeNull();

    const status = await getMfaStatus(who.userId);
    expect(status.enabledAt).toBeNull();
    expect(status.recoveryCodesRemaining).toBe(0);
  });

  it("refuses to remove the last factor while the company requires MFA", async () => {
    const ws = await workspace("required");
    const who = actor(ws.memberId, ws.companyId);
    await enrollTotp(who);
    await enrollTotp(actor(ws.owner.actorId, ws.companyId));
    await setMfaRequired(ws.owner, { required: true });

    await expect(removeTotp(who)).rejects.toThrow(ConflictError);
    expect((await getMfaStatus(who.userId)).totpConfirmedAt).not.toBeNull();
  });

  it("starts a new epoch when MFA is turned on again", async () => {
    const who = actor(await user(null), null);
    await enrollTotp(who);
    const { epoch } = await currentState(who.userId);
    await removeTotp(who);
    await enrollTotp(who, Date.now() + 2 * STEP_MS);
    expect((await currentState(who.userId)).epoch).not.toBe(epoch);
  });

  it("only removes the user's own passkeys", async () => {
    const alice = actor(await user(null), null);
    const bob = actor(await user(null), null);
    await registerPasskey(alice);
    const [alicesPasskey] = (await getMfaStatus(alice.userId)).passkeys;
    await expect(removePasskey(bob, { passkeyId: alicesPasskey?.id ?? "" })).rejects.toThrow(NotFoundError);
    expect((await getMfaStatus(alice.userId)).passkeys).toHaveLength(1);
  });
});

describe("workspace policy", () => {
  it("is an owner's call, and the owner must use MFA first", async () => {
    const ws = await workspace("policy");
    await expect(setMfaRequired(ws.admin, { required: true })).rejects.toThrow(ForbiddenError);
    await expect(setMfaRequired(ws.owner, { required: true })).rejects.toThrow(ConflictError);

    await enrollTotp(actor(ws.owner.actorId, ws.companyId));
    const policy = await setMfaRequired(ws.owner, { required: true });
    expect(policy).toEqual({ required: true, membersWithoutMfa: 2 });
    expect(await getMfaPolicy(ws.admin)).toEqual(policy);

    const logged = await db.activityLog.findFirst({ where: { companyId: ws.companyId, action: "mfa.require" } });
    expect(logged?.metadata).toEqual({ required: true, membersWithoutMfa: 2 });

    expect((await setMfaRequired(ws.owner, { required: false })).required).toBe(false);
  });
});

describe("admin reset", () => {
  it("clears a teammate's factors and ends their sessions", async () => {
    const ws = await workspace("reset");
    const member = actor(ws.memberId, ws.companyId);
    await enrollTotp(member);
    await registerPasskey(member);
    const before = await db.user.findUniqueOrThrow({ where: { id: ws.memberId } });

    const reset = await resetMemberMfa(ws.admin, { userId: ws.memberId });
    expect(reset.mfaEnabledAt).toBeNull();

    const status = await getMfaStatus(ws.memberId);
    expect(status).toMatchObject({ enabledAt: null, totpConfirmedAt: null, passkeys: [], recoveryCodesRemaining: 0 });
    const after = await db.user.findUniqueOrThrow({ where: { id: ws.memberId } });
    expect(after.sessionVersion).toBe(before.sessionVersion + 1);
    expect(await db.activityLog.count({ where: { companyId: ws.companyId, action: "mfa.reset" } })).toBe(1);

    await expect(resetMemberMfa(ws.admin, { userId: ws.memberId })).rejects.toThrow(ConflictError);
  });

  it("lets only an owner reset an owner, and nobody reset themselves", async () => {
    const ws = await workspace("reset-owner");
    await enrollTotp(actor(ws.owner.actorId, ws.companyId));
    await enrollTotp(actor(ws.admin.actorId, ws.companyId));

    await expect(resetMemberMfa(ws.admin, { userId: ws.owner.actorId })).rejects.toThrow(ForbiddenError);
    await expect(resetMemberMfa(ws.admin, { userId: ws.admin.actorId })).rejects.toThrow(ForbiddenError);
    await expect(resetMemberMfa(ws.owner, { userId: ws.admin.actorId })).resolves.toMatchObject({
      mfaEnabledAt: null,
    });
  });

  it("treats another workspace's people as missing and leaves their factors alone", async () => {
    const [mine, theirs] = await Promise.all([workspace("reset-a"), workspace("reset-b")]);
    await enrollTotp(actor(theirs.memberId, theirs.companyId));

    await expect(resetMemberMfa(mine.owner, { userId: theirs.memberId })).rejects.toThrow(NotFoundError);
    expect((await getMfaStatus(theirs.memberId)).enabledAt).not.toBeNull();
  });
});

describe("row-level security", () => {
  it("hides other workspaces' factors from a tenant transaction", async () => {
    const [mine, theirs] = await Promise.all([workspace("rls-a"), workspace("rls-b")]);
    await enrollTotp(actor(mine.memberId, mine.companyId));
    await enrollTotp(actor(theirs.memberId, theirs.companyId));
    const both = [mine.memberId, theirs.memberId];

    const seen = await tenantTransaction(mine.owner, async (tx) => ({
      totp: await tx.totpFactor.findMany({ where: { userId: { in: both } }, select: { userId: true } }),
      codes: await tx.mfaRecoveryCode.groupBy({ by: ["userId"], where: { userId: { in: both } } }),
      deleted: (await tx.mfaRecoveryCode.deleteMany({ where: { userId: theirs.memberId } })).count,
    }));
    expect(seen.totp).toEqual([{ userId: mine.memberId }]);
    expect(seen.codes.map((row) => row.userId)).toEqual([mine.memberId]);
    expect(seen.deleted).toBe(0);
    expect((await getMfaStatus(theirs.memberId)).recoveryCodesRemaining).toBe(10);
  });
});

describe("attempt limit", () => {
  it("stops guessing after ten attempts, right or wrong", async () => {
    const who = actor(await user(null), null);
    const codes = await enrollTotp(who);
    const now = Date.now() + STEP_MS;
    const right = await codeFor(who.userId, now);
    const wrong = right === "000000" ? "111111" : "000000";

    // Enrollment spent one attempt.
    for (let attempt = 0; attempt < 9; attempt += 1) {
      await expect(verifyTotpChallenge(who, wrong, now)).rejects.toThrow("didn't match");
    }
    await expect(verifyTotpChallenge(who, right, now)).rejects.toThrow("Too many attempts");
    await expect(verifyRecoveryCode(who, codes[0] ?? "")).rejects.toThrow("Too many attempts");
  });
});
