import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { OutboundRequest } from "../../src/audit/outbound";
import { drainAuditStreams, STREAM_NOT_ENTITLED } from "../../src/audit/stream";
import { db } from "../../src/db";
import { companyHasFeature } from "../../src/flags/evaluate";
import { describeCompanyFlags, setFlagOverride } from "../../src/flags/overrides";
import { listActivity } from "../../src/services/activity";
import { saveAuditStream, setAuditStreamEnabled, testAuditStream } from "../../src/services/audit";
import type { TenantContext } from "../../src/services/context";
import { createDirectory, removeDirectory } from "../../src/services/directory-sync";
import { FeatureUnavailableError, NotFoundError } from "../../src/services/errors";
import { getFeatures } from "../../src/services/features";
import { saveSsoConnection, setSsoEnforced } from "../../src/services/sso";
import { handleScimRequest } from "../../src/sso/directory";
import { closeSso } from "../../src/sso/jackson";
import { tenantTransaction } from "../../src/tenant-db";

const PUBLIC_URL = "https://93.184.216.34/resumerank-audit";

interface Workspace {
  companyId: string;
  slug: string;
  owner: TenantContext;
}

const companyIds: string[] = [];
const userIds: string[] = [];
const directoryOwners: TenantContext[] = [];

async function workspace(label: string): Promise<Workspace> {
  const tag = `${label}-${randomUUID().slice(0, 8)}`;
  const company = await db.company.create({ data: { name: `Flags ${tag}`, slug: `flags-${tag}` } });
  companyIds.push(company.id);
  const owner = await db.user.create({
    data: { name: `Owner ${tag}`, email: `owner-${tag}@example.test`, role: "OWNER", companyId: company.id },
  });
  userIds.push(owner.id);
  return { companyId: company.id, slug: company.slug, owner: { companyId: company.id, actorId: owner.id, role: "OWNER" } };
}

function turn(ws: Workspace, flag: "sso" | "directory-sync" | "audit-streaming", enabled: boolean | null) {
  return setFlagOverride({ companySlug: ws.slug, flag, enabled, reason: "integration test" });
}

let a: Workspace;
let b: Workspace;

beforeAll(async () => {
  [a, b] = await Promise.all([workspace("a"), workspace("b")]);
});

afterAll(async () => {
  for (const owner of directoryOwners) await removeDirectory(owner).catch(() => undefined);
  await db.company.deleteMany({ where: { id: { in: companyIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await closeSso();
});

describe("feature flag overrides", () => {
  it("leaves every existing feature on until staff change one", async () => {
    expect(await getFeatures(a.owner)).toEqual({ sso: true, "directory-sync": true, "audit-streaming": true });
  });

  it("applies an override to that company alone and records it in its audit log", async () => {
    const change = await turn(a, "audit-streaming", false);
    expect(change).toMatchObject({ changed: true, previous: null, decision: { enabled: false, source: "override" } });

    expect((await getFeatures(a.owner))["audit-streaming"]).toBe(false);
    expect((await getFeatures(b.owner))["audit-streaming"]).toBe(true);
    expect(await companyHasFeature(a.companyId, "audit-streaming")).toBe(false);
    expect(await companyHasFeature(b.companyId, "audit-streaming")).toBe(true);

    const feed = await listActivity(a.owner, {});
    const entry = feed.items.find((item) => item.action === "feature.override");
    expect(entry).toMatchObject({
      summary: "turned off Audit log streaming for this workspace",
      actor: { id: null, name: "ResumeRank" },
      metadata: { flag: "audit-streaming", enabled: false, previous: null, reason: "integration test" },
    });
    expect((await listActivity(b.owner, {})).items.some((item) => item.action === "feature.override")).toBe(false);
  });

  it("writes nothing when the override already says so", async () => {
    const before = await db.activityLog.count({ where: { companyId: a.companyId, action: "feature.override" } });
    expect((await turn(a, "audit-streaming", false)).changed).toBe(false);
    expect(await db.activityLog.count({ where: { companyId: a.companyId, action: "feature.override" } })).toBe(before);
  });

  it("reports each flag's decision and where it came from", async () => {
    const report = await describeCompanyFlags(a.slug);
    expect(report.flags).toEqual(
      expect.arrayContaining([
        { flag: "audit-streaming", decision: { enabled: false, source: "override" }, reason: "integration test" },
        { flag: "sso", decision: { enabled: true, source: "default" }, reason: null },
      ]),
    );
  });

  it("returns to the default when cleared", async () => {
    const change = await turn(a, "audit-streaming", null);
    expect(change).toMatchObject({ changed: true, previous: false, decision: { enabled: true, source: "default" } });
    expect(await db.featureFlagOverride.count({ where: { companyId: a.companyId } })).toBe(0);
  });

  it("refuses an unknown company", async () => {
    await expect(
      setFlagOverride({ companySlug: `missing-${randomUUID()}`, flag: "sso", enabled: true }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("lets tenants read only their own overrides and never write them", async () => {
    await turn(b, "sso", false);
    const visible = await tenantTransaction(a.owner, (tx) =>
      tx.$queryRaw<Array<{ companyId: string }>>`SELECT "companyId" FROM "FeatureFlagOverride"`,
    );
    expect(visible.every((row) => row.companyId === a.companyId)).toBe(true);
    await expect(
      tenantTransaction(a.owner, (tx) =>
        tx.$executeRaw`INSERT INTO "FeatureFlagOverride" ("id", "companyId", "flag", "enabled", "updatedAt")
          VALUES (${randomUUID()}, ${a.companyId}, 'sso', true, now())`,
      ),
    ).rejects.toThrow(/permission denied/);
    await turn(b, "sso", null);
  });
});

describe("entitlement gates", () => {
  it("refuses to connect or require SSO without it, but lets SSO be made optional", async () => {
    const ws = await workspace("sso");
    await turn(ws, "sso", false);
    await expect(
      saveSsoConnection(ws.owner, {
        type: "oidc",
        discoveryUrl: "https://93.184.216.34/.well-known/openid-configuration",
        clientId: "client",
        clientSecret: "secret",
      }),
    ).rejects.toBeInstanceOf(FeatureUnavailableError);
    await expect(setSsoEnforced(ws.owner, { enforced: true })).rejects.toBeInstanceOf(FeatureUnavailableError);
    await expect(setSsoEnforced(ws.owner, { enforced: false })).resolves.toEqual({ enforced: false });
  });

  it("refuses to connect directory sync without it, and refuses its SCIM requests once it's withdrawn", async () => {
    const ws = await workspace("scim");
    await db.companyDomain.create({
      data: { companyId: ws.companyId, domain: `${ws.slug}.example.test`, verificationToken: ws.slug, verifiedAt: new Date() },
    });

    await turn(ws, "directory-sync", false);
    await expect(createDirectory(ws.owner, { type: "okta-scim-v2" })).rejects.toBeInstanceOf(FeatureUnavailableError);

    await turn(ws, "directory-sync", null);
    const created = await createDirectory(ws.owner, { type: "okta-scim-v2" });
    directoryOwners.push(ws.owner);
    const directoryId = created.endpoint.split("/").pop() ?? "";
    const list = (apiSecret: string) =>
      handleScimRequest({ method: "GET", resourceType: "Users", directoryId, apiSecret, body: undefined, resourceId: undefined, query: {} });

    expect((await list(created.token)).status).toBe(200);

    await turn(ws, "directory-sync", false);
    const refused = await list(created.token);
    expect(refused.status).toBe(403);
    expect(refused.data).toMatchObject({ detail: "Directory sync isn't enabled for this workspace." });
    // Without the token the answer is the usual one, so it reveals nothing.
    expect((await list("not-the-token")).status).toBe(401);

    await turn(ws, "directory-sync", null);
    expect((await list(created.token)).status).toBe(200);
  });

  it("refuses to set up, test or resume a stream without it, and holds an existing one in place", async () => {
    const ws = await workspace("stream");
    await saveAuditStream(ws.owner, { kind: "WEBHOOK", url: PUBLIC_URL });

    await turn(ws, "audit-streaming", false);
    await expect(saveAuditStream(ws.owner, { kind: "WEBHOOK", url: PUBLIC_URL })).rejects.toBeInstanceOf(
      FeatureUnavailableError,
    );
    await expect(testAuditStream(ws.owner, async () => undefined)).rejects.toBeInstanceOf(FeatureUnavailableError);
    await expect(setAuditStreamEnabled(ws.owner, { enabled: false })).resolves.toMatchObject({ enabled: false });
    await expect(setAuditStreamEnabled(ws.owner, { enabled: true })).rejects.toBeInstanceOf(FeatureUnavailableError);

    await db.auditStream.update({ where: { companyId: ws.companyId }, data: { enabled: true, nextAttemptAt: new Date(0) } });
    const before = await db.auditStream.findUniqueOrThrow({ where: { companyId: ws.companyId } });
    const sent: OutboundRequest[] = [];
    const send = async (url: string, request: OutboundRequest) => {
      if (url === PUBLIC_URL) sent.push(request);
    };
    await drainAuditStreams({ send });
    const held = await db.auditStream.findUniqueOrThrow({ where: { companyId: ws.companyId } });
    expect(held).toMatchObject({ lastError: STREAM_NOT_ENTITLED, failures: 0, cursorSeq: before.cursorSeq, lockedAt: null });
    expect(held.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 30 * 60 * 1000);
    expect(sent).toHaveLength(0);

    await turn(ws, "audit-streaming", null);
    await setAuditStreamEnabled(ws.owner, { enabled: true });
    await drainAuditStreams({ send });
    expect(sent.length).toBeGreaterThan(0);
    const resumed = await db.auditStream.findUniqueOrThrow({ where: { companyId: ws.companyId } });
    expect(resumed.lastError).toBeNull();
    expect(resumed.cursorSeq).toBeGreaterThan(before.cursorSeq);
  });
});
