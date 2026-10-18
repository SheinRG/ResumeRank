import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "../../src/db";
import type { BillingGateway } from "../../src/billing/gateway";
import { purgeExpiredCandidates } from "../../src/retention/candidates";
import { listActivity } from "../../src/services/activity";
import { createApplication } from "../../src/services/applications";
import { createCandidate, deleteCandidate } from "../../src/services/candidates";
import { exportCandidateData, setCandidateRetention } from "../../src/services/data-rights";
import { DomainError, ForbiddenError, NotFoundError } from "../../src/services/errors";
import { getSelfIdLinkToken, submitSelfId } from "../../src/services/fairness";
import { deleteWorkspace, exportWorkspace } from "../../src/services/offboarding";
import type { BlobStore } from "../../src/storage/blob";
import { candidateCreateSchema } from "../../src/validators/candidate";
import { createTenant, destroyTenant, readStream, RESUME_TEXT, type TenantFixture } from "./fixtures";

let a: TenantFixture;
let b: TenantFixture;

beforeAll(async () => {
  [a, b] = await Promise.all([createTenant("lifecycle-a"), createTenant("lifecycle-b")]);
});

afterAll(async () => {
  await Promise.all([a, b].filter(Boolean).map(destroyTenant));
  await db.$disconnect();
});

function recordingStore(): BlobStore & { deleted: string[] } {
  const deleted: string[] = [];
  return {
    deleted,
    async put() {},
    async get() {
      return null;
    },
    async delete(keys) {
      deleted.push(...keys);
    },
  };
}

async function addCandidate(tenant: TenantFixture, name = `Priya Raman ${randomUUID().slice(0, 4)}`) {
  const tag = randomUUID().slice(0, 8);
  const candidate = await createCandidate(
    tenant.owner,
    candidateCreateSchema.parse({ name, email: `priya-${tag}@example.test`, source: "MANUAL", resumeText: RESUME_TEXT }),
  );
  const application = await createApplication(tenant.owner, { jobId: tenant.jobId, candidateId: candidate.id });
  return { candidateId: candidate.id, applicationId: application.id, name };
}

async function backdate(candidateId: string, applicationId: string, days: number) {
  const when = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  await db.$executeRaw`UPDATE "Candidate" SET "updatedAt" = ${when} WHERE "id" = ${candidateId}`;
  await db.$executeRaw`UPDATE "Application" SET "updatedAt" = ${when} WHERE "id" = ${applicationId}`;
}

describe("candidate names in the audit log", () => {
  it("are never written into it, and come back at read time until the candidate is erased", async () => {
    const { candidateId, name } = await addCandidate(a);

    const stored = await db.activityLog.findMany({
      where: { companyId: a.companyId, OR: [{ entityId: candidateId }, { metadata: { path: ["candidateId"], equals: candidateId } }] },
    });
    expect(stored.length).toBeGreaterThanOrEqual(2);
    for (const entry of stored) expect(entry.summary).not.toContain(name);

    const feed = await listActivity(a.owner, {});
    expect(feed.items.some((item) => item.summary === `added ${name}`)).toBe(true);

    await deleteCandidate(a.owner, candidateId, recordingStore());
    const after = await listActivity(a.owner, {});
    expect(after.items.some((item) => item.summary.includes(name))).toBe(false);
    expect(after.items.some((item) => item.summary === "added a deleted candidate")).toBe(true);
  });
});

describe("a candidate's data export", () => {
  it("contains everything held about them, and nothing about their reviewers", async () => {
    const { candidateId, applicationId, name } = await addCandidate(a);
    await submitSelfId({ token: await getSelfIdLinkToken(a.owner, applicationId), sex: "FEMALE", race: "DECLINED" });

    const data = await exportCandidateData(a.owner, candidateId);
    expect(data.candidate).toMatchObject({ id: candidateId, name, resumeText: RESUME_TEXT });
    expect(data.applications[0]).toMatchObject({
      id: applicationId,
      selfIdentification: { sex: "FEMALE", race: null },
    });
    expect(data.activity.some((entry) => entry.summary === `added ${name}`)).toBe(true);

    const owner = await db.user.findUniqueOrThrow({ where: { id: a.owner.actorId } });
    expect(JSON.stringify(data)).not.toContain(owner.name);
    expect(
      await db.activityLog.count({ where: { companyId: a.companyId, action: "candidate.data_export", entityId: candidateId } }),
    ).toBe(1);
  });

  it("is for admins of the candidate's own company", async () => {
    await expect(exportCandidateData(b.owner, a.candidateId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(exportCandidateData({ ...a.owner, role: "MEMBER" }, a.candidateId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("candidate retention", () => {
  it("deletes only candidates inactive past the company's period, with their files", async () => {
    const stale = await addCandidate(a);
    const fresh = await addCandidate(a);
    const otherCompany = await addCandidate(b);
    await backdate(stale.candidateId, stale.applicationId, 400);
    await backdate(fresh.candidateId, fresh.applicationId, 30);
    await backdate(otherCompany.candidateId, otherCompany.applicationId, 400);
    const blobKey = `${a.companyId}/resumes/${randomUUID()}.pdf`;
    await db.resumeFile.create({
      data: {
        id: randomUUID(),
        companyId: a.companyId,
        candidateId: stale.candidateId,
        blobKey,
        fileName: "cv.pdf",
        kind: "PDF",
        sizeBytes: 10,
        sha256: "x",
      },
    });
    await backdate(stale.candidateId, stale.applicationId, 400);

    await expect(setCandidateRetention({ ...a.owner, role: "ADMIN" }, { retentionDays: 365 })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await setCandidateRetention(a.owner, { retentionDays: 365 });
    const store = recordingStore();
    const { deleted } = await purgeExpiredCandidates(new Date(), store);

    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(await db.candidate.findUnique({ where: { id: stale.candidateId } })).toBeNull();
    expect(await db.candidate.findUnique({ where: { id: fresh.candidateId } })).not.toBeNull();
    expect(await db.candidate.findUnique({ where: { id: otherCompany.candidateId } })).not.toBeNull();
    expect(store.deleted).toContain(blobKey);

    const entry = await db.activityLog.findFirstOrThrow({
      where: { companyId: a.companyId, action: "candidate.retention_purge" },
      orderBy: { createdAt: "desc" },
    });
    expect(entry.summary).not.toContain(stale.name);
    await setCandidateRetention(a.owner, { retentionDays: null });
  });
});

describe("tenant offboarding", () => {
  it("exports the workspace as JSON Lines without secrets", async () => {
    const { stream } = await exportWorkspace(a.owner);
    const records = (await readStream(stream))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string; data: Record<string, unknown> });
    const types = new Set(records.map((record) => record.type));
    for (const type of ["workspace", "member", "job", "candidate", "application", "scoring_run", "audit_entry"]) {
      expect(types).toContain(type);
    }
    expect(records.filter((record) => record.type === "workspace")[0]?.data.id).toBe(a.companyId);
    expect(records.some((record) => record.type === "candidate" && record.data.companyId !== a.companyId)).toBe(false);
    await expect(exportWorkspace({ ...a.owner, role: "ADMIN" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("deletes everything the company had, cancels its subscription, and keeps people's accounts", async () => {
    const doomed = await createTenant("lifecycle-doomed");
    const company = await db.company.findUniqueOrThrow({ where: { id: doomed.companyId } });
    await db.billingAccount.create({
      data: { companyId: doomed.companyId, plan: "TEAM", stripeSubscriptionId: `sub_${randomUUID()}`, status: "ACTIVE" },
    });
    const cancelled: string[] = [];
    const gateway: BillingGateway = {
      createCustomer: async () => "cus_test",
      createCheckoutSession: async () => "https://checkout.test",
      createPortalSession: async () => "https://portal.test",
      retrieveSubscription: async () => {
        throw new Error("not used");
      },
      reportUsage: async () => {},
      cancelSubscription: async (id) => {
        cancelled.push(id);
      },
    };
    const session = await db.loginSession.create({
      data: { id: randomUUID(), userId: doomed.owner.actorId, companyId: doomed.companyId, method: "PASSWORD" },
    });

    await expect(deleteWorkspace(doomed.owner, { confirmName: "wrong" }, { gateway })).rejects.toBeInstanceOf(DomainError);
    await expect(
      deleteWorkspace({ ...doomed.owner, role: "ADMIN" }, { confirmName: company.name }, { gateway }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    process.env.STRIPE_SECRET_KEY = "sk_test_offboarding";
    try {
      await deleteWorkspace(doomed.owner, { confirmName: company.name }, { gateway, store: recordingStore() });
    } finally {
      delete process.env.STRIPE_SECRET_KEY;
    }

    expect(cancelled).toHaveLength(1);
    expect(await db.company.findUnique({ where: { id: doomed.companyId } })).toBeNull();
    for (const count of await Promise.all([
      db.candidate.count({ where: { companyId: doomed.companyId } }),
      db.scoringRun.count({ where: { companyId: doomed.companyId } }),
      db.activityLog.count({ where: { companyId: doomed.companyId } }),
      db.membership.count({ where: { companyId: doomed.companyId } }),
    ])) {
      expect(count).toBe(0);
    }
    expect(await db.user.findUnique({ where: { id: doomed.owner.actorId } })).not.toBeNull();
    expect((await db.loginSession.findUniqueOrThrow({ where: { id: session.id } })).revokedAt).toBeInstanceOf(Date);
    expect(await db.company.findUnique({ where: { id: a.companyId } })).not.toBeNull();

    await destroyTenant(doomed);
  });
});
