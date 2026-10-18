import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hashPassword } from "../../src/auth/password";
import { startLoginSession } from "../../src/auth/sessions";
import { reauthenticate, reauthMethods } from "../../src/auth/step-up";
import { db } from "../../src/db";
import { DomainError } from "../../src/services/errors";
import { createTenant, destroyTenant, type TenantFixture } from "./fixtures";

let t: TenantFixture;
let loginId: string;

beforeAll(async () => {
  t = await createTenant("step-up");
  await db.user.update({ where: { id: t.owner.actorId }, data: { passwordHash: await hashPassword("correct horse") } });
  loginId = randomUUID();
  await startLoginSession({
    id: loginId,
    userId: t.owner.actorId,
    method: "PASSWORD",
    userAgent: null,
    ipAddress: null,
    ssoCompanyId: null,
  });
});

afterAll(async () => {
  if (t) await destroyTenant(t);
});

function actor() {
  return { userId: t.owner.actorId, companyId: t.companyId, loginId };
}

describe("step-up re-authentication", () => {
  it("offers only the methods the account has", async () => {
    expect(await reauthMethods(t.owner.actorId)).toEqual({ password: true, totp: false, passkey: false });
    expect(await reauthMethods(t.memberId)).toEqual({ password: false, totp: false, passkey: false });
  });

  it("refuses a wrong password, on the field, and records it", async () => {
    const attempt = reauthenticate(actor(), { method: "password", password: "wrong horse" });
    await expect(attempt).rejects.toThrow(DomainError);
    await expect(
      reauthenticate(actor(), { method: "password", password: "wrong horse" }),
    ).rejects.toMatchObject({ fieldErrors: { password: ["That password isn't right"] } });

    const failed = await db.activityLog.count({ where: { companyId: t.companyId, action: "auth.reauth_failed" } });
    expect(failed).toBeGreaterThanOrEqual(2);
    const row = await db.loginSession.findUniqueOrThrow({ where: { id: loginId } });
    expect(row.reauthenticatedAt).toBeNull();
  });

  it("restarts the window on this sign-in only, and records it", async () => {
    const now = new Date();
    expect(await reauthenticate(actor(), { method: "password", password: "correct horse" }, now)).toEqual(now);

    const row = await db.loginSession.findUniqueOrThrow({ where: { id: loginId } });
    expect(row.reauthenticatedAt).toEqual(now);
    const entry = await db.activityLog.findFirstOrThrow({
      where: { companyId: t.companyId, action: "auth.reauthenticated" },
      orderBy: { createdAt: "desc" },
    });
    expect(entry.summary).toBe("confirmed it was them with their password");
  });

  it("can't revive a revoked sign-in", async () => {
    await db.loginSession.update({ where: { id: loginId }, data: { revokedAt: new Date() } });
    await expect(
      reauthenticate(actor(), { method: "password", password: "correct horse" }),
    ).rejects.toThrow("Your session has ended. Log in again to continue.");
  });
});
