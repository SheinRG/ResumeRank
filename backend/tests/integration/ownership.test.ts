import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { hashPassword } from "../../src/auth/password";
import { db } from "../../src/db";
import type { Role } from "../../src/generated/prisma/enums";
import type { TenantContext } from "../../src/services/context";
import { ConflictError, DomainError, ForbiddenError, NotFoundError } from "../../src/services/errors";
import { transferOwnership } from "../../src/services/team";

const companyIds: string[] = [];
const userIds: string[] = [];
const PASSWORD = "correct horse battery";

afterAll(async () => {
  await db.company.deleteMany({ where: { id: { in: companyIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.$disconnect();
});

async function company(label: string): Promise<{ id: string; name: string }> {
  const tag = `${label}-${randomUUID().slice(0, 8)}`;
  const created = await db.company.create({ data: { name: `Ownership ${tag}`, slug: `ownership-${tag}` } });
  companyIds.push(created.id);
  return created;
}

async function person(
  label: string,
  companyId: string,
  role: Role,
  { verified = true, password = false } = {},
): Promise<string> {
  const tag = `${label}-${randomUUID().slice(0, 8)}`;
  const user = await db.user.create({
    data: {
      name: `Person ${tag}`,
      email: `ownership-${tag}@example.test`,
      emailVerified: verified ? new Date() : null,
      passwordHash: password ? await hashPassword(PASSWORD) : null,
      memberships: { create: { companyId, role } },
    },
  });
  userIds.push(user.id);
  return user.id;
}

async function roleIn(userId: string, companyId: string): Promise<Role | null> {
  const membership = await db.membership.findUnique({ where: { userId_companyId: { userId, companyId } } });
  return membership?.role ?? null;
}

function ctx(companyId: string, actorId: string, role: Role): TenantContext {
  return { companyId, actorId, role };
}

async function workspace(label: string, ownerOptions: { password?: boolean } = {}) {
  const { id, name } = await company(label);
  const owner = await person(`${label}-owner`, id, "OWNER", ownerOptions);
  const admin = await person(`${label}-admin`, id, "ADMIN");
  return { companyId: id, name, owner, admin, ownerCtx: ctx(id, owner, "OWNER") };
}

describe("transferring ownership", () => {
  it("promotes the teammate and steps the owner down in one go, and records it", async () => {
    const w = await workspace("swap");
    const result = await transferOwnership(w.ownerCtx, { userId: w.admin, stayAs: "MEMBER", confirmName: w.name });

    expect(result.newOwner).toMatchObject({ id: w.admin, role: "OWNER" });
    expect(result.previousOwner).toMatchObject({ id: w.owner, role: "MEMBER" });
    expect(await roleIn(w.admin, w.companyId)).toBe("OWNER");
    expect(await roleIn(w.owner, w.companyId)).toBe("MEMBER");

    const entry = await db.activityLog.findFirst({
      where: { companyId: w.companyId, action: "company.ownership_transfer" },
    });
    expect(entry).toMatchObject({ actorId: w.owner, entityType: "company", entityId: w.companyId });
  });

  it("accepts the workspace name in any case and spacing", async () => {
    const w = await workspace("case");
    await transferOwnership(w.ownerCtx, { userId: w.admin, stayAs: "ADMIN", confirmName: `  ${w.name.toUpperCase()} ` });
    expect(await roleIn(w.admin, w.companyId)).toBe("OWNER");
  });

  it("is for owners only", async () => {
    const w = await workspace("admin-only");
    const member = await person("admin-only-member", w.companyId, "MEMBER");
    await expect(
      transferOwnership(ctx(w.companyId, w.admin, "ADMIN"), { userId: member, stayAs: "ADMIN", confirmName: w.name }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await roleIn(member, w.companyId)).toBe("MEMBER");
  });

  it("refuses a wrong workspace name, and changes nothing", async () => {
    const w = await workspace("name");
    await expect(
      transferOwnership(w.ownerCtx, { userId: w.admin, stayAs: "ADMIN", confirmName: "Some other company" }),
    ).rejects.toBeInstanceOf(DomainError);
    expect(await roleIn(w.owner, w.companyId)).toBe("OWNER");
    expect(await roleIn(w.admin, w.companyId)).toBe("ADMIN");
  });

  it("asks an owner with a password for it", async () => {
    const w = await workspace("password", { password: true });
    await expect(
      transferOwnership(w.ownerCtx, { userId: w.admin, stayAs: "ADMIN", confirmName: w.name }),
    ).rejects.toThrow("Your password is incorrect.");
    await expect(
      transferOwnership(w.ownerCtx, { userId: w.admin, stayAs: "ADMIN", confirmName: w.name, password: "wrong" }),
    ).rejects.toThrow("Your password is incorrect.");
    expect(await roleIn(w.owner, w.companyId)).toBe("OWNER");

    await transferOwnership(w.ownerCtx, { userId: w.admin, stayAs: "ADMIN", confirmName: w.name, password: PASSWORD });
    expect(await roleIn(w.admin, w.companyId)).toBe("OWNER");
  });

  it("won't go to an unverified address, an existing owner, or yourself", async () => {
    const w = await workspace("targets");
    const unverified = await person("targets-unverified", w.companyId, "ADMIN", { verified: false });
    const coOwner = await person("targets-co-owner", w.companyId, "OWNER");

    await expect(
      transferOwnership(w.ownerCtx, { userId: unverified, stayAs: "ADMIN", confirmName: w.name }),
    ).rejects.toBeInstanceOf(DomainError);
    await expect(
      transferOwnership(w.ownerCtx, { userId: coOwner, stayAs: "ADMIN", confirmName: w.name }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      transferOwnership(w.ownerCtx, { userId: w.owner, stayAs: "ADMIN", confirmName: w.name }),
    ).rejects.toBeInstanceOf(DomainError);
    expect(await roleIn(w.owner, w.companyId)).toBe("OWNER");
  });

  it("treats someone from another workspace as missing", async () => {
    const w = await workspace("cross-a");
    const other = await workspace("cross-b");
    await expect(
      transferOwnership(w.ownerCtx, { userId: other.admin, stayAs: "ADMIN", confirmName: w.name }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await roleIn(other.admin, other.companyId)).toBe("ADMIN");
  });

  it("aborts if a co-owner demoted the caller in the meantime", async () => {
    const w = await workspace("race");
    await db.membership.update({
      where: { userId_companyId: { userId: w.owner, companyId: w.companyId } },
      data: { role: "ADMIN" },
    });
    // The context still says OWNER, as it would for a request already past its guard.
    await expect(
      transferOwnership(w.ownerCtx, { userId: w.admin, stayAs: "MEMBER", confirmName: w.name }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await roleIn(w.admin, w.companyId)).toBe("ADMIN");
    expect(await roleIn(w.owner, w.companyId)).toBe("ADMIN");
  });
});
