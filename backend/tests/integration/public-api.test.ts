import { createHmac } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { authenticateApiKey } from "../../src/api/auth";
import type { OutboundRequest } from "../../src/audit/outbound";
import { OutboundError } from "../../src/audit/outbound";
import { db } from "../../src/db";
import { createApiKey, listApiKeys, revokeApiKey } from "../../src/services/api-keys";
import { createApplication, updateStage } from "../../src/services/applications";
import { createCandidate } from "../../src/services/candidates";
import { DomainError, ForbiddenError } from "../../src/services/errors";
import { listJobs } from "../../src/services/jobs";
import { removeMember, updateMemberRole } from "../../src/services/team";
import {
  createWebhook,
  deleteWebhook,
  listWebhooks,
  sendTestWebhook,
  setWebhookEnabled,
} from "../../src/services/webhooks";
import { candidateCreateSchema } from "../../src/validators/candidate";
import { drainWebhooks, MAX_WEBHOOK_ATTEMPTS } from "../../src/webhooks/delivery";
import { createTenant, RESUME_TEXT, type TenantFixture } from "./fixtures";

/** A public address literal, so creating an endpoint needs no DNS; nothing is ever sent to it. */
const ENDPOINT_URL = "https://93.184.215.14/resumerank";

let a: TenantFixture;
let b: TenantFixture;

beforeAll(async () => {
  a = await createTenant("api-a");
  b = await createTenant("api-b");
});

afterAll(async () => {
  await db.company.deleteMany({ where: { id: { in: [a.companyId, b.companyId] } } });
  await db.user.deleteMany({ where: { id: { in: [...a.userIds, ...b.userIds] } } });
  await db.$disconnect();
});

function capture() {
  const sent: { url: string; request: OutboundRequest }[] = [];
  return {
    sent,
    send: async (url: string, request: OutboundRequest) => {
      sent.push({ url, request });
    },
  };
}

async function newCandidate(fixture: TenantFixture, label: string): Promise<string> {
  const candidate = await createCandidate(
    fixture.owner,
    candidateCreateSchema.parse({
      name: `API ${label}`,
      email: `api-${label}-${Date.now()}@example.test`,
      source: "MANUAL",
      resumeText: RESUME_TEXT,
    }),
  );
  return candidate.id;
}

describe("API keys", () => {
  it("authenticates as the creator with the scopes it was given", async () => {
    const { key, token } = await createApiKey(a.owner, {
      name: "HRIS sync",
      scopes: ["jobs:read", "applications:write"],
      expiresInDays: 30,
    });
    expect(token.startsWith(key.prefix)).toBe(true);

    const principal = await authenticateApiKey(token);
    expect(principal).toMatchObject({
      keyId: key.id,
      scopes: ["jobs:read", "applications:write"],
      ctx: { companyId: a.companyId, actorId: a.owner.actorId, role: "OWNER" },
    });
    expect((await db.apiKey.findUniqueOrThrow({ where: { id: key.id } })).lastUsedAt).not.toBeNull();

    // The context works with the services like a session's does.
    if (!principal) throw new Error("The key didn't authenticate.");
    const jobs = await listJobs(principal.ctx, { q: "", sort: "newest" });
    expect(jobs.items.map((job) => job.id)).toEqual([a.jobId]);
  });

  it("stores only a hash and refuses a wrong secret, a revoked key and an expired one", async () => {
    const { key, token } = await createApiKey(a.owner, { name: "Rotating", scopes: ["jobs:read"], expiresInDays: null });
    const stored = await db.apiKey.findUniqueOrThrow({ where: { id: key.id } });
    expect(stored.secretHash).not.toContain(token.split("_").at(-1));

    const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    expect(await authenticateApiKey(tampered)).toBeNull();
    expect(await authenticateApiKey("rr_garbage")).toBeNull();
    expect(await authenticateApiKey(`Bearer ${token}`)).toBeNull();

    await revokeApiKey(a.owner, key.id);
    expect(await authenticateApiKey(token)).toBeNull();

    const expiring = await createApiKey(a.owner, { name: "Short", scopes: ["jobs:read"], expiresInDays: 30 });
    expect(await authenticateApiKey(expiring.token, new Date(Date.now() + 31 * 24 * 60 * 60 * 1000))).toBeNull();
  });

  it("follows its creator: a demotion narrows it and leaving the workspace deletes it", async () => {
    const admin = await db.user.create({
      data: {
        name: "Key admin",
        email: `key-admin-${Date.now()}@example.test`,
        memberships: { create: { companyId: a.companyId, role: "ADMIN" } },
      },
    });
    a.userIds.push(admin.id);
    const adminCtx = { companyId: a.companyId, actorId: admin.id, role: "ADMIN" as const };
    const { key, token } = await createApiKey(adminCtx, { name: "Admin's", scopes: ["jobs:read"], expiresInDays: null });

    await updateMemberRole(a.owner, { userId: admin.id, role: "VIEWER" });
    expect((await authenticateApiKey(token))?.ctx.role).toBe("VIEWER");

    await removeMember(a.owner, { userId: admin.id });
    expect(await authenticateApiKey(token)).toBeNull();
    expect(await db.apiKey.findUnique({ where: { id: key.id } })).toBeNull();
  });

  it("is managed by admins only", async () => {
    await expect(
      createApiKey(a.viewer, { name: "Nope", scopes: ["jobs:read"], expiresInDays: null }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listApiKeys(a.viewer)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("webhooks", () => {
  it("refuses an endpoint on a private network", async () => {
    await expect(
      createWebhook(a.owner, { url: "https://127.0.0.1/hook", events: ["application.created"] }),
    ).rejects.toBeInstanceOf(DomainError);
    await expect(
      createWebhook(a.owner, { url: "http://93.184.215.14/hook", events: ["application.created"] }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("queues subscribed events with the change and delivers them signed", async () => {
    const { endpoint, signingSecret } = await createWebhook(b.owner, {
      url: ENDPOINT_URL,
      events: ["application.created", "application.stage_changed"],
    });
    const candidateId = await newCandidate(b, "signed");
    const application = await createApplication(b.owner, { jobId: b.jobId, candidateId });
    await updateStage(b.owner, { id: application.id, stage: "SCREENING" });
    // Same stage again: nothing changed, so nothing is sent.
    await updateStage(b.owner, { id: application.id, stage: "SCREENING" });

    const { sent, send } = capture();
    const result = await drainWebhooks({ send });
    expect(result).toEqual({ delivered: 2, failed: 0 });

    const bodies = sent.map(({ url, request }) => {
      expect(url).toBe(ENDPOINT_URL);
      const header = request.headers["ResumeRank-Signature"] ?? "";
      const [, timestamp, digest] = /^t=(\d+),v1=([0-9a-f]+)$/.exec(header) ?? [];
      expect(createHmac("sha256", signingSecret).update(`${timestamp}.${request.body}`).digest("hex")).toBe(digest);
      return JSON.parse(request.body) as { id: string; type: string; data: Record<string, unknown> };
    });
    expect(bodies.map((body) => body.type).sort()).toEqual(["application.created", "application.stage_changed"]);
    const moved = bodies.find((body) => body.type === "application.stage_changed");
    expect(moved?.data).toMatchObject({
      application: { id: application.id, stage: "SCREENING" },
      previousStage: "NEW",
    });

    const [view] = await listWebhooks(b.owner);
    expect(view).toMatchObject({ id: endpoint.id, lastError: null });
    expect(view?.recentDeliveries.every((d) => d.status === "DELIVERED")).toBe(true);
    await deleteWebhook(b.owner, endpoint.id);
  });

  it("retries a failing endpoint with backoff, then gives up", async () => {
    const { endpoint } = await createWebhook(b.owner, { url: ENDPOINT_URL, events: ["application.created"] });
    await sendTestWebhook(b.owner, endpoint.id);
    const failing = async () => {
      throw new OutboundError("The endpoint answered 503.", 503);
    };

    expect(await drainWebhooks({ send: failing })).toEqual({ delivered: 0, failed: 1 });
    const pending = await db.webhookDelivery.findFirstOrThrow({ where: { endpointId: endpoint.id } });
    expect(pending).toMatchObject({ status: "PENDING", attempts: 1, lastError: "The endpoint answered 503." });
    expect(pending.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    // Backing off: an immediate second drain leaves it alone.
    expect(await drainWebhooks({ send: failing })).toEqual({ delivered: 0, failed: 0 });

    await db.webhookDelivery.update({
      where: { id: pending.id },
      data: { attempts: MAX_WEBHOOK_ATTEMPTS - 1, nextAttemptAt: new Date(0) },
    });
    await drainWebhooks({ send: failing });
    expect(await db.webhookDelivery.findUniqueOrThrow({ where: { id: pending.id } })).toMatchObject({
      status: "FAILED",
      attempts: MAX_WEBHOOK_ATTEMPTS,
    });
    await deleteWebhook(b.owner, endpoint.id);
  });

  it("holds events while paused, sends them on resume, and skips unsubscribed ones", async () => {
    const { endpoint } = await createWebhook(b.owner, { url: ENDPOINT_URL, events: ["application.created"] });
    const candidateId = await newCandidate(b, "paused");

    await setWebhookEnabled(b.owner, { id: endpoint.id, enabled: false });
    const application = await createApplication(b.owner, { jobId: b.jobId, candidateId });
    // Not subscribed: never queued.
    await updateStage(b.owner, { id: application.id, stage: "INTERVIEW" });
    expect(await db.webhookDelivery.count({ where: { endpointId: endpoint.id } })).toBe(1);

    const { sent, send } = capture();
    await drainWebhooks({ send });
    expect(sent).toHaveLength(0);

    await setWebhookEnabled(b.owner, { id: endpoint.id, enabled: true });
    await drainWebhooks({ send });
    expect(sent.map(({ request }) => request.headers["ResumeRank-Event"])).toEqual(["application.created"]);
    await deleteWebhook(b.owner, endpoint.id);
  });

  it("is managed by admins only", async () => {
    await expect(
      createWebhook(b.viewer, { url: ENDPOINT_URL, events: ["application.created"] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listWebhooks(b.viewer)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
