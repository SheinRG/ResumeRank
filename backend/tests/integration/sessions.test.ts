import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import {
  endLoginSession,
  listLoginSessions,
  revokeLoginSession,
  revokeOtherLoginSessions,
  startLoginSession,
  touchLoginSession,
  type SessionActor,
} from "../../src/auth/sessions";
import { db } from "../../src/db";
import type { TenantContext } from "../../src/services/context";
import { ConflictError, ForbiddenError, NotFoundError } from "../../src/services/errors";
import { getSessionPolicy, setSessionPolicy, signOutMember } from "../../src/services/sessions";
import { removeMember } from "../../src/services/team";
import { closeSso } from "../../src/sso/jackson";
import { tenantTransaction } from "../../src/tenant-db";

const CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:142.0) Gecko/20100101 Firefox/142.0";
const MINUTE = 60_000;

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
    data: { name: `Sessions ${role.toLowerCase()} ${tag}`, email: `sessions-${tag}@example.test`, role, companyId },
  });
  userIds.push(created.id);
  return created.id;
}

async function workspace(label: string): Promise<Workspace> {
  const tag = `${label}-${randomUUID().slice(0, 8)}`;
  const company = await db.company.create({ data: { name: `Sessions ${tag}`, slug: `sessions-${tag}` } });
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

/** `at` backdates the sign-in, so idle and lifetime limits can be checked without waiting. */
async function signIn(userId: string, userAgent = CHROME_WINDOWS, at?: Date): Promise<string> {
  const id = randomUUID();
  await startLoginSession({ id, userId, method: "PASSWORD", userAgent, ipAddress: "203.0.113.7", ssoCompanyId: null });
  if (at) await db.loginSession.update({ where: { id }, data: { createdAt: at, lastSeenAt: at } });
  return id;
}

async function liveIds(userId: string): Promise<string[]> {
  const rows = await db.loginSession.findMany({ where: { userId, revokedAt: null }, select: { id: true } });
  return rows.map((row) => row.id).sort();
}

afterAll(async () => {
  await db.company.deleteMany({ where: { id: { in: companyIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await closeSso();
  await db.$disconnect();
});

describe("signing in", () => {
  it("records the sign-in and clears the user's revoked rows", async () => {
    const userId = await user(null);
    const old = await signIn(userId);
    await endLoginSession(old);

    const fresh = await signIn(userId);
    const rows = await db.loginSession.findMany({ where: { userId } });
    expect(rows.map((row) => row.id)).toEqual([fresh]);
    expect(rows[0]).toMatchObject({ method: "PASSWORD", ipAddress: "203.0.113.7", revokedAt: null });
  });

  it("can't revive a revoked session by touching it", async () => {
    const userId = await user(null);
    const id = await signIn(userId);
    await endLoginSession(id);
    await touchLoginSession(id);
    expect(await liveIds(userId)).toEqual([]);
  });
});

describe("listing sessions", () => {
  it("shows live sessions with the current one first, and hides idle ones", async () => {
    const ws = await workspace("list");
    await setSessionPolicy(ws.owner, { lifetimeMinutes: 8 * 60, idleMinutes: 30 });
    const now = Date.now();
    const idle = await signIn(ws.memberId, CHROME_WINDOWS, new Date(now - 45 * MINUTE));
    const other = await signIn(ws.memberId, FIREFOX_LINUX, new Date(now - 5 * MINUTE));
    const current = await signIn(ws.memberId);

    const sessions = await listLoginSessions(ws.memberId, current);
    expect(sessions.map((session) => session.id)).toEqual([current, other]);
    expect(sessions.map((session) => session.id)).not.toContain(idle);
    expect(sessions[0]).toMatchObject({ current: true, device: "Chrome on Windows", method: "PASSWORD" });
    expect(sessions[1]).toMatchObject({ current: false, device: "Firefox on Linux" });
    expect(sessions[1]?.expiresAt.getTime()).toBe(now - 5 * MINUTE + 30 * MINUTE);
  });
});

describe("revoking your own sessions", () => {
  it("ends another of your sessions and logs it", async () => {
    const ws = await workspace("revoke");
    const current = await signIn(ws.memberId);
    const other = await signIn(ws.memberId, FIREFOX_LINUX);
    const who: SessionActor = { userId: ws.memberId, companyId: ws.companyId, loginId: current };

    const revoked = await revokeLoginSession(who, other);
    expect(revoked.id).toBe(other);
    expect(await liveIds(ws.memberId)).toEqual([current]);
    const logged = await db.activityLog.findFirst({ where: { companyId: ws.companyId, action: "session.revoke" } });
    expect(logged?.summary).toBe("signed out a session on Firefox on Linux");

    await expect(revokeLoginSession(who, other)).rejects.toThrow(NotFoundError);
  });

  it("refuses the session making the request", async () => {
    const userId = await user(null);
    const current = await signIn(userId);
    await expect(revokeLoginSession({ userId, companyId: null, loginId: current }, current)).rejects.toThrow(
      ConflictError,
    );
  });

  it("treats someone else's session id as missing", async () => {
    const [mine, theirs] = await Promise.all([user(null), user(null)]);
    const current = await signIn(mine);
    const victim = await signIn(theirs);
    await expect(revokeLoginSession({ userId: mine, companyId: null, loginId: current }, victim)).rejects.toThrow(
      NotFoundError,
    );
    expect(await liveIds(theirs)).toEqual([victim]);
  });

  it("signs out of every other session, keeping this one", async () => {
    const userId = await user(null);
    const current = await signIn(userId);
    await Promise.all([signIn(userId), signIn(userId, FIREFOX_LINUX)]);

    const result = await revokeOtherLoginSessions({ userId, companyId: null, loginId: current });
    expect(result.revoked).toBe(2);
    expect(await liveIds(userId)).toEqual([current]);
  });
});

describe("session policy", () => {
  it("starts at the defaults and only an owner can change it", async () => {
    const ws = await workspace("policy");
    expect(await getSessionPolicy(ws.admin)).toEqual({ lifetimeMinutes: 43200, idleMinutes: 10080 });

    await expect(setSessionPolicy(ws.admin, { lifetimeMinutes: 60, idleMinutes: 15 })).rejects.toThrow(
      ForbiddenError,
    );
    const policy = await setSessionPolicy(ws.owner, { lifetimeMinutes: 720, idleMinutes: 60 });
    expect(policy).toEqual({ lifetimeMinutes: 720, idleMinutes: 60 });
    expect(await getSessionPolicy(ws.admin)).toEqual(policy);
    const logged = await db.activityLog.findFirst({ where: { companyId: ws.companyId, action: "session.policy" } });
    expect(logged?.metadata).toEqual({ lifetimeMinutes: 720, idleMinutes: 60 });
  });
});

describe("signing a teammate out", () => {
  it("revokes every session under RLS and bumps the session version", async () => {
    const ws = await workspace("signout");
    await Promise.all([signIn(ws.memberId), signIn(ws.memberId, FIREFOX_LINUX)]);
    const before = await db.user.findUniqueOrThrow({ where: { id: ws.memberId } });

    await signOutMember(ws.admin, { userId: ws.memberId });

    expect(await liveIds(ws.memberId)).toEqual([]);
    const after = await db.user.findUniqueOrThrow({ where: { id: ws.memberId } });
    expect(after.sessionVersion).toBe(before.sessionVersion + 1);
    const logged = await db.activityLog.findFirst({ where: { companyId: ws.companyId, action: "user.sign_out" } });
    expect(logged?.metadata).toEqual({ revoked: 2 });
  });

  it("leaves owners to owners, and yourself to Security settings", async () => {
    const ws = await workspace("signout-rules");
    await expect(signOutMember(ws.admin, { userId: ws.owner.actorId })).rejects.toThrow(ForbiddenError);
    await expect(signOutMember(ws.admin, { userId: ws.admin.actorId })).rejects.toThrow(ForbiddenError);
    await expect(signOutMember(ws.owner, { userId: ws.admin.actorId })).resolves.toMatchObject({
      id: ws.admin.actorId,
    });
  });

  it("revokes a removed member's sessions before they leave the company", async () => {
    const ws = await workspace("remove");
    await signIn(ws.memberId);
    await removeMember(ws.admin, { userId: ws.memberId });
    expect(await liveIds(ws.memberId)).toEqual([]);
  });

  it("can't see or revoke another company's sessions inside a tenant transaction", async () => {
    const [mine, theirs] = await Promise.all([workspace("rls-a"), workspace("rls-b")]);
    const victim = await signIn(theirs.memberId);

    const visible = await tenantTransaction(mine.owner, (tx) =>
      tx.loginSession.findMany({ where: { userId: theirs.memberId } }),
    );
    expect(visible).toEqual([]);
    const revoked = await tenantTransaction(mine.owner, (tx) =>
      tx.loginSession.updateMany({ where: { id: victim }, data: { revokedAt: new Date() } }),
    );
    expect(revoked.count).toBe(0);
    expect(await liveIds(theirs.memberId)).toEqual([victim]);
  });
});
