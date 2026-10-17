import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { accountPasswordPolicy, companyPasswordPolicy } from "../../src/auth/password-policy";
import { startLoginSession } from "../../src/auth/sessions";
import { consumePasswordResetToken, createPasswordResetToken, findPasswordResetUser } from "../../src/auth/tokens";
import { db } from "../../src/db";
import type { TenantContext } from "../../src/services/context";
import { ForbiddenError } from "../../src/services/errors";
import { getPasswordPolicy, setPasswordPolicy } from "../../src/services/password-policy";
import { createTenant, destroyTenant, type TenantFixture } from "./fixtures";

let t: TenantFixture;
let admin: TenantContext;
let otherCompanyId: string;

beforeAll(async () => {
  t = await createTenant("password-policy");
  admin = { ...t.owner, role: "ADMIN" };
  const other = await db.company.create({
    data: { name: `Other ${randomUUID().slice(0, 8)}`, slug: `pw-other-${randomUUID().slice(0, 8)}` },
  });
  otherCompanyId = other.id;
});

afterAll(async () => {
  if (otherCompanyId) await db.company.deleteMany({ where: { id: otherCompanyId } });
  if (t) await destroyTenant(t);
});

describe("password policy", () => {
  it("starts at the defaults", async () => {
    expect(await getPasswordPolicy(admin)).toEqual({ minLength: 8, breachCheck: false });
  });

  it("is set by owners only, and audited", async () => {
    await expect(setPasswordPolicy(admin, { minLength: 12, breachCheck: true })).rejects.toThrow(ForbiddenError);
    await expect(getPasswordPolicy(t.viewer)).rejects.toThrow(ForbiddenError);

    expect(await setPasswordPolicy(t.owner, { minLength: 12, breachCheck: false })).toEqual({
      minLength: 12,
      breachCheck: false,
    });
    const entry = await db.activityLog.findFirstOrThrow({
      where: { companyId: t.companyId, action: "company.password_policy" },
      orderBy: { createdAt: "desc" },
    });
    expect(entry.summary).toBe("set the password policy to at least 12 characters");
    expect(await companyPasswordPolicy(t.companyId)).toEqual({ minLength: 12, breachCheck: false });
  });

  it("holds an account to the strictest policy among its workspaces", async () => {
    await db.company.update({
      where: { id: otherCompanyId },
      data: { passwordMinLength: 10, passwordBreachCheck: true },
    });
    await db.membership.create({ data: { userId: t.owner.actorId, companyId: otherCompanyId, role: "MEMBER" } });
    expect(await accountPasswordPolicy(t.owner.actorId)).toEqual({ minLength: 12, breachCheck: true });
  });

  it("looks up a reset link's account without using the link up", async () => {
    const raw = await createPasswordResetToken(t.owner.actorId);
    expect(await findPasswordResetUser(raw)).toBe(t.owner.actorId);
    expect(await findPasswordResetUser(raw)).toBe(t.owner.actorId);
    expect(await consumePasswordResetToken(raw)).toBe(t.owner.actorId);
    expect(await findPasswordResetUser(raw)).toBeNull();
  });

  it("records a sign-in held for a new password", async () => {
    const id = randomUUID();
    await startLoginSession({
      id,
      userId: t.owner.actorId,
      method: "PASSWORD",
      userAgent: null,
      ipAddress: null,
      ssoCompanyId: null,
      passwordChangeRequired: true,
    });
    const row = await db.loginSession.findUniqueOrThrow({ where: { id } });
    expect(row.passwordChangeRequired).toBe(true);
  });
});
