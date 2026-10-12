import { createHmac, randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { logActivity } from "../../src/activity";
import { purgeExpiredAuditEntries } from "../../src/audit/retention";
import { drainAuditStreams } from "../../src/audit/stream";
import type { OutboundRequest } from "../../src/audit/outbound";
import { SIGNATURE_HEADER } from "../../src/audit/stream-format";
import { endLoginSession, startLoginSession } from "../../src/auth/sessions";
import { db } from "../../src/db";
import { listActivity } from "../../src/services/activity";
import {
  exportAuditLog,
  getAuditSettings,
  removeAuditStream,
  saveAuditStream,
  setAuditRetention,
  setAuditStreamEnabled,
  testAuditStream,
  verifyAuditLog,
} from "../../src/services/audit";
import type { TenantContext } from "../../src/services/context";
import { DomainError, ForbiddenError } from "../../src/services/errors";
import { closeSso } from "../../src/sso/jackson";
import { tenantTransaction } from "../../src/tenant-db";
import { readStream } from "./fixtures";

const DAY = 24 * 60 * 60 * 1000;
// A public address literal: saving a stream checks the host isn't private,
// and a literal needs no DNS. Nothing is ever sent there; tests inject `send`.
const PUBLIC_URL = "https://93.184.216.34/resumerank-audit";

interface Workspace {
  companyId: string;
  owner: TenantContext;
  admin: TenantContext;
  member: TenantContext;
}

const companyIds: string[] = [];
const userIds: string[] = [];

async function user(companyId: string, role: "OWNER" | "ADMIN" | "MEMBER"): Promise<string> {
  const tag = randomUUID().slice(0, 8);
  const created = await db.user.create({
    data: { name: `Audit ${role.toLowerCase()} ${tag}`, email: `audit-${tag}@example.test`, role, companyId },
  });
  userIds.push(created.id);
  return created.id;
}

async function workspace(label: string): Promise<Workspace> {
  const tag = `${label}-${randomUUID().slice(0, 8)}`;
  const company = await db.company.create({ data: { name: `Audit ${tag}`, slug: `audit-${tag}` } });
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
    member: { companyId: company.id, actorId: memberId, role: "MEMBER" },
  };
}

async function record(ctx: TenantContext, summary: string): Promise<void> {
  await tenantTransaction(ctx, (tx) =>
    logActivity(
      {
        companyId: ctx.companyId,
        actorId: ctx.actorId,
        action: "job.update",
        entityType: "job",
        entityId: `job-${summary}`,
        summary,
        metadata: { note: summary, nested: { b: 2, a: 1 } },
      },
      tx,
    ),
  );
}

/** Backdated entries for retention, written the way old ones were: by an ordinary insert. */
async function recordAt(companyId: string, summary: string, createdAt: Date): Promise<void> {
  await db.activityLog.create({
    data: { companyId, actorId: null, action: "job.update", entityType: "job", entityId: "job", summary, createdAt },
  });
}

async function chain(companyId: string) {
  return db.activityLog.findMany({
    where: { companyId },
    orderBy: { seq: "asc" },
    select: { id: true, seq: true, prevHash: true, hash: true, action: true, summary: true, metadata: true },
  });
}

/**
 * Runs `fn` with triggers off (superuser only), standing in for someone
 * editing the table directly: the guard is bypassed, so only the chain can
 * notice.
 */
async function tamper(fn: (tx: Parameters<Parameters<typeof db.$transaction>[0]>[0]) => Promise<unknown>) {
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
    await fn(tx);
  });
}

afterAll(async () => {
  await db.company.deleteMany({ where: { id: { in: companyIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await closeSso();
  await db.$disconnect();
});

describe("the hash chain", () => {
  it("seals each entry as its transaction commits, linked to the one before", async () => {
    const ws = await workspace("seal");
    await record(ws.owner, "first");
    await record(ws.owner, "second");
    await record(ws.owner, "third");

    const entries = await chain(ws.companyId);
    expect(entries.map((entry) => Number(entry.seq))).toEqual([1, 2, 3]);
    expect(entries[0].prevHash).toBeNull();
    expect(entries[1].prevHash).toBe(entries[0].hash);
    expect(entries[2].prevHash).toBe(entries[1].hash);
    expect(entries.every((entry) => /^[0-9a-f]{64}$/.test(entry.hash ?? ""))).toBe(true);

    expect(await verifyAuditLog(ws.admin)).toMatchObject({ checked: 3, firstSeq: 1, lastSeq: 3, fault: null });
  });

  it("keeps one gapless chain under concurrent writers", async () => {
    const ws = await workspace("concurrent");
    await Promise.all(Array.from({ length: 12 }, (_, index) => record(ws.owner, `parallel ${index}`)));

    const entries = await chain(ws.companyId);
    expect(entries.map((entry) => Number(entry.seq))).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
    expect((await verifyAuditLog(ws.owner)).fault).toBeNull();
  });

  it("leaves an entry unsealed only inside the transaction that wrote it", async () => {
    const ws = await workspace("pending");
    await tenantTransaction(ws.owner, async (tx) => {
      await logActivity(
        { companyId: ws.companyId, actorId: ws.owner.actorId, action: "job.create", entityType: "job", entityId: "j", summary: "created" },
        tx,
      );
      const [pending] = await tx.activityLog.findMany({ where: { companyId: ws.companyId }, select: { seq: true } });
      expect(pending.seq).toBeNull();
    });
    const [sealed] = await chain(ws.companyId);
    expect(Number(sealed.seq)).toBe(1);
  });

  it("refuses edits and deletes, even on the owner connection", async () => {
    const ws = await workspace("guard");
    await record(ws.owner, "kept");
    const [entry] = await chain(ws.companyId);

    await expect(
      db.activityLog.update({ where: { id: entry.id }, data: { summary: "rewritten" } }),
    ).rejects.toThrow(/cannot be changed/);
    await expect(db.activityLog.update({ where: { id: entry.id }, data: { hash: "0".repeat(64) } })).rejects.toThrow(
      /cannot be changed/,
    );
    await expect(db.activityLog.delete({ where: { id: entry.id } })).rejects.toThrow(/cannot be deleted/);
    await expect(db.$executeRaw`TRUNCATE "ActivityLog"`).rejects.toThrow(/cannot be truncated/);
    expect(await chain(ws.companyId)).toEqual([entry]);
  });

  it("lets deleting an account clear its actor without breaking the chain", async () => {
    const ws = await workspace("erasure");
    await record(ws.member, "by a leaver");
    await db.user.delete({ where: { id: ws.member.actorId } });

    const [entry] = await db.activityLog.findMany({ where: { companyId: ws.companyId }, select: { actorId: true } });
    expect(entry.actorId).toBeNull();
    expect((await verifyAuditLog(ws.owner)).fault).toBeNull();
  });

  it("detects an entry edited around the guard", async () => {
    const ws = await workspace("altered");
    for (const summary of ["one", "two", "three"]) await record(ws.owner, summary);
    const entries = await chain(ws.companyId);

    await tamper((tx) => tx.activityLog.update({ where: { id: entries[1].id }, data: { summary: "two (edited)" } }));
    expect(await verifyAuditLog(ws.owner)).toMatchObject({ checked: 1, lastSeq: 1, fault: { seq: 2, fault: "altered" } });
  });

  it("detects a metadata change, whatever its key order", async () => {
    const ws = await workspace("metadata");
    await record(ws.owner, "one");
    const [entry] = await chain(ws.companyId);

    await tamper((tx) =>
      tx.activityLog.update({ where: { id: entry.id }, data: { metadata: { nested: { a: 1, b: 2 }, note: "one" } } }),
    );
    expect((await verifyAuditLog(ws.owner)).fault).toBeNull();

    await tamper((tx) => tx.activityLog.update({ where: { id: entry.id }, data: { metadata: { note: "other" } } }));
    expect((await verifyAuditLog(ws.owner)).fault).toEqual({ seq: 1, fault: "altered" });
  });

  it("detects a deleted entry in the middle", async () => {
    const ws = await workspace("missing");
    for (const summary of ["one", "two", "three", "four"]) await record(ws.owner, summary);
    const entries = await chain(ws.companyId);

    await tamper((tx) => tx.activityLog.delete({ where: { id: entries[2].id } }));
    expect((await verifyAuditLog(ws.owner)).fault).toEqual({ seq: 3, fault: "missing" });
  });

  it("detects the oldest entries deleted outside the retention policy", async () => {
    const ws = await workspace("unanchored");
    for (const summary of ["one", "two", "three"]) await record(ws.owner, summary);
    const entries = await chain(ws.companyId);

    await tamper((tx) => tx.activityLog.deleteMany({ where: { id: { in: [entries[0].id, entries[1].id] } } }));
    expect((await verifyAuditLog(ws.owner)).fault).toEqual({ seq: 3, fault: "unanchored" });
  });

  it("only lets admins verify", async () => {
    const ws = await workspace("verify-role");
    await expect(verifyAuditLog(ws.member)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("retention", () => {
  it("purges expired entries, records the cut, and still verifies", async () => {
    const ws = await workspace("retention");
    const now = new Date();
    await recordAt(ws.companyId, "ancient 1", new Date(now.getTime() - 400 * DAY));
    await recordAt(ws.companyId, "ancient 2", new Date(now.getTime() - 200 * DAY));
    await recordAt(ws.companyId, "ancient 3", new Date(now.getTime() - 100 * DAY));
    await record(ws.owner, "recent");
    await setAuditRetention(ws.owner, { retentionDays: 90 });

    await purgeExpiredAuditEntries(now);

    const entries = await chain(ws.companyId);
    expect(entries.map((entry) => entry.action)).toEqual(["job.update", "audit.retention", "audit.purge"]);
    expect(Number(entries[0].seq)).toBe(4);
    expect(entries[2].metadata).toMatchObject({ deleted: 3, retentionDays: 90, throughSeq: 3 });
    expect(await verifyAuditLog(ws.owner)).toMatchObject({ firstSeq: 4, fault: null });

    await purgeExpiredAuditEntries(now);
    expect(await chain(ws.companyId)).toHaveLength(3);
  });

  it("never deletes the newest entry, so the chain keeps counting", async () => {
    const ws = await workspace("tip");
    const now = new Date();
    await recordAt(ws.companyId, "old 1", new Date(now.getTime() - 300 * DAY));
    await recordAt(ws.companyId, "old 2", new Date(now.getTime() - 200 * DAY));
    await db.company.update({ where: { id: ws.companyId }, data: { auditRetentionDays: 90 } });

    await purgeExpiredAuditEntries(now);

    const entries = await chain(ws.companyId);
    expect(entries.map((entry) => [Number(entry.seq), entry.summary])).toEqual([
      [2, "old 2"],
      [3, "deleted 1 audit entry older than 90 days"],
    ]);
    expect((await verifyAuditLog(ws.owner)).fault).toBeNull();
  });

  it("is an owner's decision, from the listed periods", async () => {
    const ws = await workspace("retention-role");
    await expect(setAuditRetention(ws.admin, { retentionDays: 365 })).rejects.toBeInstanceOf(ForbiddenError);
    expect(await setAuditRetention(ws.owner, { retentionDays: 365 })).toEqual({ retentionDays: 365 });
    expect((await getAuditSettings(ws.admin)).retentionDays).toBe(365);
  });
});

describe("export", () => {
  it("exports CSV with chain hashes, pinned to when it started, and records itself", async () => {
    const ws = await workspace("export-csv");
    await record(ws.owner, "=cmd|' /C calc'!A0");
    await record(ws.owner, "second");

    const { rowCount, stream } = await exportAuditLog(ws.admin, { format: "csv" });
    const lines = (await readStream(stream)).trim().split("\n");
    const entries = await chain(ws.companyId);

    expect(rowCount).toBe(2);
    expect(lines[0]).toBe("seq,timestamp,action,entity_type,entity_id,actor_id,actor_name,actor_email,summary,metadata,prev_hash,hash");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("'=cmd");
    expect(lines[2]).toContain(entries[1].hash);
    expect(entries.at(-1)).toMatchObject({ action: "audit.export", metadata: { format: "csv", rowCount: 2, throughSeq: 2 } });
  });

  it("exports JSON Lines within a date range", async () => {
    const ws = await workspace("export-jsonl");
    await recordAt(ws.companyId, "last year", new Date(Date.now() - 365 * DAY));
    await record(ws.owner, "today");
    const today = new Date().toISOString().slice(0, 10);

    const { stream } = await exportAuditLog(ws.owner, { format: "jsonl", from: today, to: today });
    const events = (await readStream(stream))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ seq: 2, summary: "today", companyId: ws.companyId, entityType: "job" });
  });

  it("only lets admins export", async () => {
    const ws = await workspace("export-role");
    await expect(exportAuditLog(ws.member, { format: "csv" })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("streaming", () => {
  function capture() {
    const sent: { url: string; request: OutboundRequest }[] = [];
    const send = async (url: string, request: OutboundRequest) => {
      sent.push({ url, request });
    };
    return { sent, send };
  }

  async function makeDue(companyId: string) {
    await db.auditStream.update({ where: { companyId }, data: { nextAttemptAt: new Date(0) } });
  }

  it("starts from the newest entry and delivers what follows, in order and signed", async () => {
    const ws = await workspace("stream");
    await record(ws.owner, "before streaming");
    const saved = await saveAuditStream(ws.owner, { kind: "WEBHOOK", url: PUBLIC_URL });
    expect(saved.signingSecret).toMatch(/^whsec_/);
    expect(saved.stream).toMatchObject({ kind: "WEBHOOK", enabled: true, pending: 0 });

    await record(ws.owner, "after 1");
    await record(ws.owner, "after 2");
    const { sent, send } = capture();
    await drainAuditStreams({ send });

    expect(sent).toHaveLength(1);
    const [{ url, request }] = sent;
    expect(url).toBe(PUBLIC_URL);
    const body = JSON.parse(request.body) as { events: { seq: number; summary: string }[] };
    expect(body.events.map((event) => [event.seq, event.summary])).toEqual([
      [2, "connected audit log streaming to a webhook at 93.184.216.34"],
      [3, "after 1"],
      [4, "after 2"],
    ]);
    const [timestamp, signature] = request.headers[SIGNATURE_HEADER].split(",").map((part) => part.split("=")[1]);
    const expected = createHmac("sha256", saved.signingSecret ?? "").update(`${timestamp}.${request.body}`).digest("hex");
    expect(signature).toBe(expected);

    const { sent: again, send: sendAgain } = capture();
    await drainAuditStreams({ send: sendAgain });
    expect(again).toHaveLength(0);
    expect((await getAuditSettings(ws.owner)).stream).toMatchObject({ pending: 0, failures: 0, lastError: null });
  });

  it("backs off after a failure and resumes without losing entries", async () => {
    const ws = await workspace("stream-retry");
    await saveAuditStream(ws.owner, { kind: "SPLUNK", url: PUBLIC_URL, token: "hec-token" });
    await record(ws.owner, "must arrive");

    await drainAuditStreams({
      send: async () => {
        throw new Error("The endpoint answered 503.");
      },
    });
    const failed = await db.auditStream.findUniqueOrThrow({ where: { companyId: ws.companyId } });
    expect(failed).toMatchObject({ failures: 1, lastError: "The endpoint answered 503.", cursorSeq: BigInt(0) });
    expect(failed.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

    const { sent, send } = capture();
    await drainAuditStreams({ send });
    expect(sent).toHaveLength(0);

    await makeDue(ws.companyId);
    await drainAuditStreams({ send });
    expect(sent).toHaveLength(1);
    expect(sent[0].request.headers.Authorization).toBe("Splunk hec-token");
    expect(sent[0].request.body).toContain("must arrive");
    expect(await db.auditStream.findUniqueOrThrow({ where: { companyId: ws.companyId } })).toMatchObject({
      failures: 0,
      lastError: null,
      cursorSeq: BigInt(2),
    });
  });

  it("holds its place while paused and catches up on resume", async () => {
    const ws = await workspace("stream-pause");
    await saveAuditStream(ws.owner, { kind: "DATADOG", url: PUBLIC_URL, token: "dd-key" });
    await setAuditStreamEnabled(ws.owner, { enabled: false });
    await record(ws.owner, "while paused");

    const { sent, send } = capture();
    await drainAuditStreams({ send });
    expect(sent).toHaveLength(0);

    await setAuditStreamEnabled(ws.owner, { enabled: true });
    await drainAuditStreams({ send });
    const delivered = JSON.parse(sent[0].request.body) as { audit: { summary: string } }[];
    expect(delivered.map((log) => log.audit.summary)).toEqual([
      "connected audit log streaming to Datadog at 93.184.216.34",
      "paused audit log streaming",
      "while paused",
      "resumed audit log streaming",
    ]);
  });

  it("won't hand a token to a destination it wasn't saved for", async () => {
    const ws = await workspace("stream-moved");
    await saveAuditStream(ws.owner, { kind: "SPLUNK", url: PUBLIC_URL, token: "hec-token" });
    await db.auditStream.update({
      where: { companyId: ws.companyId },
      data: { url: "https://8.8.8.8/collector" },
    });

    const { sent, send } = capture();
    await drainAuditStreams({ send });
    expect(sent).toHaveLength(0);
    expect((await db.auditStream.findUniqueOrThrow({ where: { companyId: ws.companyId } })).lastError).toMatch(
      /can't be decrypted/,
    );
  });

  it("keeps a saved token when the destination changes, and needs one to start", async () => {
    const ws = await workspace("stream-edit");
    await expect(saveAuditStream(ws.owner, { kind: "SPLUNK", url: PUBLIC_URL })).rejects.toBeInstanceOf(DomainError);
    await saveAuditStream(ws.owner, { kind: "SPLUNK", url: PUBLIC_URL, token: "hec-token" });
    await saveAuditStream(ws.owner, { kind: "SPLUNK", url: "https://8.8.8.8/collector" });

    const { sent, send } = capture();
    await testAuditStream(ws.owner, send);
    expect(sent[0]).toMatchObject({ url: "https://8.8.8.8/collector" });
    expect(sent[0].request.headers.Authorization).toBe("Splunk hec-token");
    expect(sent[0].request.body).toContain("audit.stream_test");
  });

  it("refuses private destinations", async () => {
    const ws = await workspace("stream-ssrf");
    for (const url of ["https://169.254.169.254/latest", "https://localhost/hook", "https://10.0.0.8/hook"]) {
      await expect(saveAuditStream(ws.owner, { kind: "WEBHOOK", url })).rejects.toThrow(/private network/);
    }
  });

  it("is an owner's decision", async () => {
    const ws = await workspace("stream-role");
    await expect(saveAuditStream(ws.admin, { kind: "WEBHOOK", url: PUBLIC_URL })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await saveAuditStream(ws.owner, { kind: "WEBHOOK", url: PUBLIC_URL });
    await expect(removeAuditStream(ws.admin)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await removeAuditStream(ws.owner)).toEqual({ kind: "WEBHOOK" });
    expect((await getAuditSettings(ws.owner)).stream).toBeNull();
  });
});

describe("sign-in events", () => {
  it("records sign-ins and sign-outs, shown to admins only", async () => {
    const ws = await workspace("auth");
    const loginId = randomUUID();
    await startLoginSession({
      id: loginId,
      userId: ws.member.actorId,
      method: "PASSWORD",
      userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:142.0) Gecko/20100101 Firefox/142.0",
      ssoCompanyId: null,
      ipAddress: "203.0.113.7",
    });
    await endLoginSession(loginId);
    await endLoginSession(loginId);

    const entries = await chain(ws.companyId);
    expect(entries.map((entry) => entry.action)).toEqual(["auth.sign_in", "auth.sign_out"]);
    expect(entries[0].metadata).toMatchObject({ method: "PASSWORD", ipAddress: "203.0.113.7", loginId });

    expect((await listActivity(ws.admin, {})).items.map((item) => item.action)).toEqual([
      "auth.sign_out",
      "auth.sign_in",
    ]);
    expect((await listActivity(ws.member, {})).items).toEqual([]);
  });

  it("records nothing for someone without a workspace", async () => {
    const loose = await db.user.create({
      data: { name: "No company", email: `audit-loose-${randomUUID().slice(0, 8)}@example.test` },
    });
    userIds.push(loose.id);
    await startLoginSession({ id: randomUUID(), userId: loose.id, method: "GOOGLE", userAgent: null, ipAddress: null, ssoCompanyId: null });
    expect(await db.activityLog.count({ where: { actorId: loose.id } })).toBe(0);
  });
});
