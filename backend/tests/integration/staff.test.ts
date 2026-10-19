import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { authenticateApiKey } from "../../src/api/auth";
import { db } from "../../src/db";
import { createApiKey } from "../../src/services/api-keys";
import { DomainError, ForbiddenError, NotFoundError } from "../../src/services/errors";
import { getSupportAccess, setSupportAccess } from "../../src/services/support-access";
import type { StaffActor } from "../../src/staff/actor";
import { searchCompanies, setAiBudgetOverride, setSuspension } from "../../src/staff/companies";
import { grantStaff, revokeStaff } from "../../src/staff/members";
import { liftSuppression, signOutMember } from "../../src/staff/support";
import { activeSupportSession, endSupportSession, startSupportSession } from "../../src/staff/support-sessions";
import { tenantDb, tenantTransaction } from "../../src/tenant-db";
import { createTenant, destroyTenant, type TenantFixture } from "./fixtures";

const REASON = "Ticket 4821: reproduce the reported issue";

let a: TenantFixture;
let b: TenantFixture;
let admin: StaffActor;
let support: StaffActor;
const staffUserIds: string[] = [];

async function staffAccount(role: "ADMIN" | "SUPPORT"): Promise<StaffActor> {
  const tag = randomUUID().slice(0, 8);
  const user = await db.user.create({ data: { name: `Staff ${tag}`, email: `staff-${tag}@resumerank.test` } });
  staffUserIds.push(user.id);
  await grantStaff({ userId: null, email: "cli:integration-test" }, user.email, role);
  return { userId: user.id, email: user.email, name: user.name, role, ipAddress: "203.0.113.9" };
}

async function loginFor(userId: string): Promise<string> {
  const id = randomUUID();
  await db.loginSession.create({ data: { id, userId, method: "PASSWORD" } });
  return id;
}

async function grantSupportAccess(fixture: TenantFixture, days: 1 | 3 | 7 = 1): Promise<void> {
  await setSupportAccess(fixture.owner, { days });
}

beforeAll(async () => {
  [a, b] = await Promise.all([createTenant("staff-a"), createTenant("staff-b")]);
  [admin, support] = await Promise.all([staffAccount("ADMIN"), staffAccount("SUPPORT")]);
});

afterAll(async () => {
  await Promise.all([a, b].filter(Boolean).map(destroyTenant));
  await db.user.deleteMany({ where: { id: { in: staffUserIds } } });
  await db.$disconnect();
});

describe("staff data the tenant can't touch", () => {
  it("keeps the staff audit log append-only for every role", async () => {
    const entry = await db.staffAuditEntry.findFirstOrThrow({ where: { staffEmail: "cli:integration-test" } });
    await expect(
      db.staffAuditEntry.update({ where: { id: entry.id }, data: { summary: "rewritten" } }),
    ).rejects.toThrow(/append-only/);
    await expect(db.staffAuditEntry.delete({ where: { id: entry.id } })).rejects.toThrow(/append-only/);
  });

  it("refuses the tenant role suspending its own workspace or setting its AI budget", async () => {
    await expect(
      tenantTransaction(a.owner, (tx) => tx.company.update({ where: { id: a.companyId }, data: { suspendedAt: new Date() } })),
    ).rejects.toThrow(/Only ResumeRank staff/);
    await expect(
      tenantTransaction(a.owner, (tx) => tx.company.update({ where: { id: a.companyId }, data: { aiTokenBudget: 1 } })),
    ).rejects.toThrow(/Only ResumeRank staff/);
    // Everything else on the row stays the tenant's to change.
    await tenantTransaction(a.owner, (tx) =>
      tx.company.update({ where: { id: a.companyId }, data: { website: "https://example.test" } }),
    );
  });

  it("gives the tenant role no access to the staff tables", async () => {
    await expect(
      tenantTransaction(a.owner, (tx) => tx.$queryRaw`SELECT "id" FROM "StaffAuditEntry"`),
    ).rejects.toThrow(/permission denied/);
    await expect(tenantTransaction(a.owner, (tx) => tx.$queryRaw`SELECT "userId" FROM "StaffMember"`)).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe("read-only tenant contexts", () => {
  it("lets Postgres refuse every write in a read-only tenant transaction", async () => {
    const readOnly = { ...a.owner, readOnly: true };
    await expect(
      tenantTransaction(readOnly, (tx) => tx.job.update({ where: { id: a.jobId }, data: { title: "Changed" } })),
    ).rejects.toThrow(/read-only transaction/);
    const job = await tenantTransaction(readOnly, (tx) => tx.job.findUniqueOrThrow({ where: { id: a.jobId } }));
    expect(job.title).not.toBe("Changed");
  });

  it("leaves ordinary tenant transactions writable on the same pooled connections", async () => {
    await tenantTransaction(a.owner, (tx) => tx.job.update({ where: { id: a.jobId }, data: { location: "Remote" } }));
    expect((await db.job.findUniqueOrThrow({ where: { id: a.jobId } })).location).toBe("Remote");
  });
});

describe("tenant search", () => {
  it("finds a workspace by a member's email and records the search", async () => {
    const owner = await db.user.findUniqueOrThrow({ where: { id: a.owner.actorId } });
    const results = await searchCompanies(support, owner.email);
    expect(results.map((company) => company.id)).toEqual([a.companyId]);
    const logged = await db.staffAuditEntry.findFirst({
      where: { staffUserId: support.userId, action: "staff.search" },
      orderBy: { createdAt: "desc" },
    });
    expect(logged?.summary).toContain(owner.email);
  });
});

describe("suspension", () => {
  it("is for staff admins only", async () => {
    await expect(setSuspension(support, { companyId: a.companyId, suspended: true, reason: REASON })).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("refuses the workspace's API keys and records itself in both logs", async () => {
    const { token } = await createApiKey(b.owner, { name: "Suspended", scopes: ["jobs:read"], expiresInDays: null });
    expect((await authenticateApiKey(token))?.suspended).toBe(false);

    const suspended = await setSuspension(admin, { companyId: b.companyId, suspended: true, reason: REASON });
    expect(suspended.suspendedAt).not.toBeNull();
    expect((await authenticateApiKey(token))?.suspended).toBe(true);
    expect(await db.activityLog.count({ where: { companyId: b.companyId, action: "company.suspend", actorId: null } })).toBe(1);
    const entry = await db.staffAuditEntry.findFirstOrThrow({
      where: { companyId: b.companyId, action: "staff.suspend" },
    });
    expect(entry.metadata).toMatchObject({ reason: REASON });

    const lifted = await setSuspension(admin, { companyId: b.companyId, suspended: false, reason: REASON });
    expect(lifted.suspendedAt).toBeNull();
    expect((await authenticateApiKey(token))?.suspended).toBe(false);
  });
});

describe("AI budget override", () => {
  it("replaces the plan's budget and returns to it", async () => {
    expect((await setAiBudgetOverride(admin, { companyId: a.companyId, budget: 12_345, reason: REASON })).budget).toBe(
      12_345,
    );
    const back = await setAiBudgetOverride(admin, { companyId: a.companyId, budget: null, reason: REASON });
    expect(back.budget).not.toBe(12_345);
    expect(await db.activityLog.count({ where: { companyId: a.companyId, action: "company.ai_budget" } })).toBe(2);
  });
});

describe("support tooling", () => {
  it("lifts an email suppression only for the workspace's own people", async () => {
    const member = await db.user.findUniqueOrThrow({ where: { id: a.memberId } });
    await db.emailSuppression.create({ data: { email: member.email, reason: "bounce" } });

    await expect(liftSuppression(support, { companyId: b.companyId, email: member.email, reason: REASON })).rejects.toThrow(
      NotFoundError,
    );
    expect(await liftSuppression(support, { companyId: a.companyId, email: member.email, reason: REASON })).toEqual({
      lifted: true,
    });
    expect(await db.emailSuppression.count({ where: { email: member.email } })).toBe(0);
  });

  it("signs a member out everywhere and treats another workspace's member as missing", async () => {
    await loginFor(a.memberId);
    const before = await db.user.findUniqueOrThrow({ where: { id: a.memberId }, select: { sessionVersion: true } });

    await expect(signOutMember(support, { companyId: b.companyId, userId: a.memberId, reason: REASON })).rejects.toThrow(
      NotFoundError,
    );
    const { revoked } = await signOutMember(support, { companyId: a.companyId, userId: a.memberId, reason: REASON });
    expect(revoked).toBeGreaterThanOrEqual(1);
    const after = await db.user.findUniqueOrThrow({ where: { id: a.memberId }, select: { sessionVersion: true } });
    expect(after.sessionVersion).toBe(before.sessionVersion + 1);
    expect(await db.loginSession.count({ where: { userId: a.memberId, revokedAt: null } })).toBe(0);
  });
});

describe("support sessions", () => {
  it("needs the workspace's grant, and only owners give it", async () => {
    const loginId = await loginFor(support.userId);
    await setSupportAccess(a.owner, { days: 0 });
    await expect(
      startSupportSession(support, loginId, { companyId: a.companyId, userId: a.memberId, reason: REASON, minutes: 15 }),
    ).rejects.toThrow(/hasn't given ResumeRank support access/);
    await expect(setSupportAccess({ ...a.owner, role: "ADMIN" }, { days: 1 })).rejects.toThrow(ForbiddenError);
  });

  it("starts, shows the workspace, and ends with an entry in its log", async () => {
    const loginId = await loginFor(support.userId);
    await grantSupportAccess(a);
    const started = await startSupportSession(support, loginId, {
      companyId: a.companyId,
      userId: a.memberId,
      reason: REASON,
      minutes: 30,
    });
    expect(started.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(30 * 60_000);

    const live = await activeSupportSession(loginId, support.userId);
    expect(live?.targetUserId).toBe(a.memberId);
    // Another sign-in, or another staff member on this one, isn't in it.
    expect(await activeSupportSession(await loginFor(support.userId), support.userId)).toBeNull();
    expect(await activeSupportSession(loginId, admin.userId)).toBeNull();

    const access = await getSupportAccess(a.owner);
    expect(access.sessions[0]).toMatchObject({ id: started.id, reason: REASON });
    expect(await getSupportAccess(b.owner)).toMatchObject({ sessions: [] });
    expect(await tenantDb(b.owner).supportSession.count({ where: { id: started.id } })).toBe(0);

    expect(await endSupportSession(support, loginId)).toBe(a.companyId);
    expect(await activeSupportSession(loginId, support.userId)).toBeNull();
    const actions = await db.activityLog.findMany({
      where: { companyId: a.companyId, action: { startsWith: "support.session" } },
      select: { action: true, summary: true },
    });
    expect(actions.map((entry) => entry.action).sort()).toEqual(["support.session_end", "support.session_start"]);
    expect(actions.find((entry) => entry.action === "support.session_start")?.summary).toContain(REASON);
  });

  it("can't outlast the grant, and ends when the owner withdraws it", async () => {
    const loginId = await loginFor(support.userId);
    await grantSupportAccess(a);
    await db.company.update({
      where: { id: a.companyId },
      data: { supportAccessUntil: new Date(Date.now() + 5 * 60_000) },
    });
    const started = await startSupportSession(support, loginId, {
      companyId: a.companyId,
      userId: a.memberId,
      reason: REASON,
      minutes: 60,
    });
    expect(started.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 5 * 60_000);

    await setSupportAccess(a.owner, { days: 0 });
    expect(await activeSupportSession(loginId, support.userId)).toBeNull();
    const row = await db.supportSession.findUniqueOrThrow({ where: { id: started.id } });
    expect(row.endedAt).not.toBeNull();
  });

  it("ends when the staff member loses staff access", async () => {
    const staff = await staffAccount("SUPPORT");
    const loginId = await loginFor(staff.userId);
    await grantSupportAccess(a);
    await startSupportSession(staff, loginId, { companyId: a.companyId, userId: a.memberId, reason: REASON, minutes: 15 });
    expect(await activeSupportSession(loginId, staff.userId)).not.toBeNull();

    await revokeStaff({ userId: null, email: "cli:integration-test" }, staff.email);
    expect(await activeSupportSession(loginId, staff.userId)).toBeNull();
  });

  it("refuses viewing as yourself or as someone outside the workspace", async () => {
    const loginId = await loginFor(support.userId);
    await grantSupportAccess(a);
    await expect(
      startSupportSession(support, loginId, { companyId: a.companyId, userId: b.memberId, reason: REASON, minutes: 15 }),
    ).rejects.toThrow(NotFoundError);
    await db.membership.create({ data: { userId: support.userId, companyId: a.companyId, role: "MEMBER" } });
    await expect(
      startSupportSession(support, loginId, { companyId: a.companyId, userId: support.userId, reason: REASON, minutes: 15 }),
    ).rejects.toThrow(DomainError);
    await db.membership.delete({ where: { userId_companyId: { userId: support.userId, companyId: a.companyId } } });
  });
});
