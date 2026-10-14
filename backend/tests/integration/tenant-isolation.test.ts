import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startLoginSession } from "../../src/auth/sessions";
import { switchWorkspace } from "../../src/auth/workspaces";
import { db } from "../../src/db";
import { listActivity } from "../../src/services/activity";
import { exportAuditLog, getAuditSettings, verifyAuditLog } from "../../src/services/audit";
import {
  createApplication,
  getApplication,
  listApplicationsForJob,
  setApplicationRemoved,
  updateStage,
} from "../../src/services/applications";
import {
  createCandidate,
  deleteCandidate,
  exportCandidatesCsv,
  getCandidate,
  listCandidates,
  searchCandidateOptions,
  updateCandidate,
} from "../../src/services/candidates";
import { getCompany } from "../../src/services/company";
import { getDashboardData } from "../../src/services/dashboard";
import {
  addDepartmentMember,
  deleteDepartment,
  listDepartmentOptions,
  listDepartments,
  removeDepartmentMember,
  renameDepartment,
} from "../../src/services/departments";
import { assignToJob, getHiringTeam, setJobDepartment, unassignFromJob } from "../../src/services/hiring-team";
import { NotFoundError } from "../../src/services/errors";
import { getFeatures } from "../../src/services/features";
import { getJob, listJobOptions, listJobs, setJobStatus, updateJob } from "../../src/services/jobs";
import { resetMemberMfa } from "../../src/services/mfa";
import { upsertScorecard } from "../../src/services/scorecards";
import { signOutMember } from "../../src/services/sessions";
import { getSsoSettings, removeDomain, setDomainAutoJoin, verifyDomain } from "../../src/services/sso";
import { closeSso } from "../../src/sso/jackson";
import {
  getJobScoringProgress,
  getScoringRun,
  requestJobScoring,
  requestScoring,
} from "../../src/services/scoring";
import { createApiKey, listApiKeys, revokeApiKey } from "../../src/services/api-keys";
import {
  createWebhook,
  deleteWebhook,
  listWebhooks,
  sendTestWebhook,
  setWebhookEnabled,
} from "../../src/services/webhooks";
import {
  listPendingInvites,
  listTeam,
  removeMember,
  revokeInvite,
  transferOwnership,
  updateMemberRole,
} from "../../src/services/team";
import { candidateCreateSchema, candidateUpdateSchema } from "../../src/validators/candidate";
import { jobUpdateSchema } from "../../src/validators/job";
import {
  applicationListParamsSchema,
  candidateListParamsSchema,
  jobListParamsSchema,
} from "../../src/validators/search";
import {
  createTenant,
  destroyTenant,
  readStream,
  RESUME_TEXT,
  type TenantFixture,
} from "./fixtures";

/** Everything tenant A's probes could conceivably touch in tenant B. */
async function snapshot(tenant: TenantFixture) {
  const [job, candidate, application, member, memberships, invite, domain, activityCount, department, assignments] = await Promise.all([
    db.job.findUnique({
      where: { id: tenant.jobId },
      include: { requirements: { orderBy: { order: "asc" } } },
    }),
    db.candidate.findUnique({ where: { id: tenant.candidateId } }),
    db.application.findUnique({
      where: { id: tenant.applicationId },
      include: { scorecards: true, scoringRuns: { include: { evaluations: true } } },
    }),
    db.user.findUnique({ where: { id: tenant.memberId } }),
    db.membership.findMany({ where: { companyId: tenant.companyId }, orderBy: { id: "asc" } }),
    db.companyInvite.findUnique({ where: { id: tenant.inviteId } }),
    db.companyDomain.findUnique({ where: { id: tenant.domainId } }),
    db.activityLog.count({ where: { companyId: tenant.companyId } }),
    db.department.findUnique({ where: { id: tenant.departmentId }, include: { members: true } }),
    db.jobAssignment.findMany({ where: { companyId: tenant.companyId }, orderBy: { id: "asc" } }),
  ]);
  const [apiKeys, webhookEndpoints] = await Promise.all([
    db.apiKey.findMany({ where: { companyId: tenant.companyId }, orderBy: { id: "asc" } }),
    db.webhookEndpoint.findMany({
      where: { companyId: tenant.companyId },
      include: { deliveries: true },
      orderBy: { id: "asc" },
    }),
  ]);
  return {
    job,
    candidate,
    application,
    member,
    memberships,
    invite,
    domain,
    activityCount,
    department,
    assignments,
    apiKeys,
    webhookEndpoints,
  };
}

let a: TenantFixture;
let b: TenantFixture;
let bBefore: Awaited<ReturnType<typeof snapshot>>;
let bApiKeyId: string;
let bEndpointId: string;

beforeAll(async () => {
  [a, b] = await Promise.all([createTenant("iso-a"), createTenant("iso-b")]);
  bApiKeyId = (await createApiKey(b.owner, { name: "B's key", scopes: ["jobs:read"], expiresInDays: null })).key.id;
  bEndpointId = (
    await createWebhook(b.owner, { url: "https://93.184.215.14/isolation", events: ["application.created"] })
  ).endpoint.id;
  bBefore = await snapshot(b);
});

afterAll(async () => {
  await Promise.all([a, b].filter(Boolean).map(destroyTenant));
  await closeSso();
  await db.$disconnect();
});

describe("reads never return another tenant's rows", () => {
  it("treats another tenant's ids as missing", async () => {
    expect(await getJob(a.owner, b.jobId)).toBeNull();
    expect(await getCandidate(a.owner, b.candidateId)).toBeNull();
    expect(await getApplication(a.owner, b.applicationId)).toBeNull();
  });

  it("hides another tenant's scoring runs and job progress", async () => {
    expect(await getScoringRun(a.owner, b.scoringRunId)).toBeNull();
    expect(await getJobScoringProgress(a.owner, b.jobId)).toBeNull();
    expect((await getScoringRun(a.owner, a.scoringRunId))?.id).toBe(a.scoringRunId);
  });

  it("returns the caller's own rows by id", async () => {
    expect((await getJob(a.owner, a.jobId))?.id).toBe(a.jobId);
    expect((await getCandidate(a.owner, a.candidateId))?.id).toBe(a.candidateId);
    expect((await getApplication(a.owner, a.applicationId))?.id).toBe(a.applicationId);
  });

  it("lists only the caller's jobs and candidates", async () => {
    const jobs = await listJobs(a.owner, jobListParamsSchema.parse({}));
    expect(jobs.items.map((j) => j.id)).toEqual([a.jobId]);
    expect(jobs.total).toBe(1);

    const jobOptions = await listJobOptions(a.owner);
    expect(jobOptions.map((j) => j.id)).toEqual([a.jobId]);

    const candidates = await listCandidates(a.owner, candidateListParamsSchema.parse({}));
    expect(candidates.items.map((c) => c.id)).toEqual([a.candidateId]);

    const searched = await listCandidates(
      a.owner,
      candidateListParamsSchema.parse({ q: b.candidateEmail }),
    );
    expect(searched.items).toEqual([]);
  });

  it("offers only the caller's candidates to attach, whatever job id is passed", async () => {
    const forOwnJob = await searchCandidateOptions(a.owner, a.jobId, { q: "" });
    expect(forOwnJob).toEqual([]);

    const forOtherJob = await searchCandidateOptions(a.owner, b.jobId, { q: "" });
    expect(forOtherJob.map((c) => c.id)).toEqual([a.candidateId]);
  });

  it("returns an empty pipeline for another tenant's job", async () => {
    const page = await listApplicationsForJob(
      a.owner,
      b.jobId,
      applicationListParamsSchema.parse({}),
    );
    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
  });

  it("lists only the caller's team and invites", async () => {
    const team = await listTeam(a.owner);
    expect(team.map((m) => m.id).sort()).toEqual([...a.userIds].sort());

    const invites = await listPendingInvites(a.owner);
    expect(invites.map((i) => i.id)).toEqual([a.inviteId]);
  });

  it("lists only the caller's departments and hiring teams", async () => {
    expect((await listDepartments(a.owner)).map((d) => d.id)).toEqual([a.departmentId]);
    expect((await listDepartmentOptions(a.owner)).map((d) => d.id)).toEqual([a.departmentId]);
    expect(await getHiringTeam(a.owner, b.jobId)).toBeNull();
    expect((await getHiringTeam(a.owner, a.jobId))?.department?.id).toBe(a.departmentId);
  });

  it("lists only the caller's API keys and webhook endpoints", async () => {
    expect((await listApiKeys(a.owner)).map((key) => key.id)).not.toContain(bApiKeyId);
    expect((await listWebhooks(a.owner)).map((endpoint) => endpoint.id)).not.toContain(bEndpointId);
  });

  it("lists only the caller's SSO domains", async () => {
    const settings = await getSsoSettings(a.owner);
    expect(settings.domains.map((d) => d.id)).toEqual([a.domainId]);
  });

  it("decides features from the caller's overrides only", async () => {
    await db.featureFlagOverride.create({ data: { companyId: b.companyId, flag: "sso", enabled: false } });
    expect((await getFeatures(a.owner)).sso).toBe(true);
    expect((await getFeatures(b.owner)).sso).toBe(false);
  });

  it("reads only the caller's company and activity", async () => {
    expect((await getCompany(a.owner))?.id).toBe(a.companyId);

    const activity = await listActivity(a.owner, {});
    const ownTotal = await db.activityLog.count({ where: { companyId: a.companyId } });
    expect(activity.total).toBe(ownTotal);
    const otherTenantIds = new Set([b.jobId, b.candidateId, b.applicationId]);
    expect(activity.items.some((item) => otherTenantIds.has(item.entityId))).toBe(false);
  });

  it("aggregates the dashboard over the caller's tenant only", async () => {
    const { stats, recentActivity } = await getDashboardData(a.owner);
    expect(stats).toMatchObject({
      openJobs: 1,
      totalJobs: 1,
      totalCandidates: 1,
      activeApplications: 1,
    });
    const otherTenantIds = new Set([b.jobId, b.candidateId, b.applicationId]);
    expect(recentActivity.some((item) => otherTenantIds.has(item.entityId))).toBe(false);
  });

  it("verifies, reports and exports only the caller's audit log", async () => {
    const ownSeqs = await db.activityLog.aggregate({
      where: { companyId: a.companyId },
      _max: { seq: true },
      _count: { _all: true },
    });
    const settings = await getAuditSettings(a.owner);
    expect(settings.latestSeq).toBe(Number(ownSeqs._max.seq));

    const report = await verifyAuditLog(a.owner);
    expect(report).toMatchObject({ fault: null, checked: ownSeqs._count._all });

    const { stream } = await exportAuditLog(a.owner, { format: "jsonl" });
    const events = (await readStream(stream))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events.length).toBe(ownSeqs._count._all);
    expect(events.every((event) => event.companyId === a.companyId)).toBe(true);
  });

  it("exports only the caller's candidates", async () => {
    const { rowCount, stream } = await exportCandidatesCsv(
      a.owner,
      candidateListParamsSchema.parse({}),
    );
    const csv = await readStream(stream);
    expect(rowCount).toBe(1);
    expect(csv).toContain(a.candidateEmail);
    expect(csv).not.toContain(b.candidateEmail);
  });
});

describe("writes to another tenant's ids fail as not found", () => {
  it("rejects job edits and status changes", async () => {
    const input = jobUpdateSchema.parse({
      id: b.jobId,
      title: "Hijacked title",
      description: "An attempt to rewrite another tenant's job posting.",
      employmentType: "CONTRACT",
      status: "OPEN",
      requirements: [{ label: "Anything at all", weight: "MUST" }],
    });
    await expect(updateJob(a.owner, input)).rejects.toThrow(NotFoundError);
    await expect(setJobStatus(a.owner, b.jobId, "ARCHIVED")).rejects.toThrow(NotFoundError);
  });

  it("treats another job's requirement id as a new requirement, never an edit", async () => {
    const foreign = await db.jobRequirement.findFirstOrThrow({ where: { jobId: b.jobId } });
    const own = await getJob(a.owner, a.jobId);
    if (!own) throw new Error("fixture job missing");

    const updated = await updateJob(
      a.owner,
      jobUpdateSchema.parse({
        id: a.jobId,
        title: own.title,
        description: own.description,
        employmentType: own.employmentType,
        status: own.status,
        requirements: [{ id: foreign.id, label: "Rewritten label", weight: "NICE" }],
      }),
    );

    expect(updated.requirements).toHaveLength(1);
    expect(updated.requirements[0].id).not.toBe(foreign.id);
    expect(await db.jobRequirement.findUnique({ where: { id: foreign.id } })).toEqual(foreign);
  });

  it("rejects candidate edits and deletion", async () => {
    const input = candidateUpdateSchema.parse({
      id: b.candidateId,
      name: "Hijacked Name",
      email: "hijacked@example.test",
      source: "MANUAL",
      resumeText: RESUME_TEXT,
    });
    await expect(updateCandidate(a.owner, input)).rejects.toThrow(NotFoundError);
    await expect(deleteCandidate(a.owner, b.candidateId)).rejects.toThrow(NotFoundError);
  });

  it("refuses to attach another tenant's job or candidate", async () => {
    await expect(
      createApplication(a.owner, { jobId: b.jobId, candidateId: a.candidateId }),
    ).rejects.toMatchObject({ name: "NotFoundError", fieldErrors: { jobId: expect.any(Array) } });
    await expect(
      createApplication(a.owner, { jobId: a.jobId, candidateId: b.candidateId }),
    ).rejects.toMatchObject({
      name: "NotFoundError",
      fieldErrors: { candidateId: expect.any(Array) },
    });
  });

  it("rejects stage moves, removal, scorecards and scoring", async () => {
    await expect(updateStage(a.owner, { id: b.applicationId, stage: "HIRED" })).rejects.toThrow(
      NotFoundError,
    );
    await expect(setApplicationRemoved(a.owner, b.applicationId, true)).rejects.toThrow(
      NotFoundError,
    );
    await expect(
      upsertScorecard(a.owner, { applicationId: b.applicationId, rating: 1 }),
    ).rejects.toThrow(NotFoundError);
    await expect(requestScoring(a.owner, b.applicationId)).rejects.toThrow(NotFoundError);
    await expect(requestJobScoring(a.owner, b.jobId)).rejects.toThrow(NotFoundError);
  });

  it("rejects role changes, removal, MFA resets, sign-outs, ownership transfers and invite revocation", async () => {
    const { name } = await db.company.findUniqueOrThrow({ where: { id: a.companyId }, select: { name: true } });
    await expect(
      updateMemberRole(a.owner, { userId: b.memberId, role: "ADMIN" }),
    ).rejects.toThrow(NotFoundError);
    await expect(removeMember(a.owner, { userId: b.memberId })).rejects.toThrow(NotFoundError);
    await expect(resetMemberMfa(a.owner, { userId: b.memberId })).rejects.toThrow(NotFoundError);
    await expect(signOutMember(a.owner, { userId: b.memberId })).rejects.toThrow(NotFoundError);
    await expect(
      transferOwnership(a.owner, { userId: b.memberId, stayAs: "ADMIN", confirmName: name }),
    ).rejects.toThrow(NotFoundError);
    await expect(revokeInvite(a.owner, b.inviteId)).rejects.toThrow(NotFoundError);
  });

  it("rejects revoking another tenant's API key and changing its webhook endpoints", async () => {
    await expect(revokeApiKey(a.owner, bApiKeyId)).rejects.toThrow(NotFoundError);
    await expect(setWebhookEnabled(a.owner, { id: bEndpointId, enabled: false })).rejects.toThrow(NotFoundError);
    await expect(sendTestWebhook(a.owner, bEndpointId)).rejects.toThrow(NotFoundError);
    await expect(deleteWebhook(a.owner, bEndpointId)).rejects.toThrow(NotFoundError);

    // A's changes never queue events for B's endpoint; the snapshot check below confirms it.
    const candidate = await createCandidate(
      a.owner,
      candidateCreateSchema.parse({
        name: "Webhook probe",
        email: `webhook-probe-${Date.now()}@example.test`,
        source: "MANUAL",
        resumeText: RESUME_TEXT,
      }),
    );
    await createApplication(a.owner, { jobId: a.jobId, candidateId: candidate.id });
  });

  it("refuses to open another tenant's workspace in a sign-in", async () => {
    const loginId = randomUUID();
    await startLoginSession({
      id: loginId,
      userId: a.owner.actorId,
      method: "PASSWORD",
      userAgent: null,
      ipAddress: null,
      ssoCompanyId: null,
    });
    await expect(switchWorkspace({ userId: a.owner.actorId, loginId }, b.companyId)).rejects.toThrow(
      NotFoundError,
    );
    expect((await db.loginSession.findUniqueOrThrow({ where: { id: loginId } })).companyId).toBe(a.companyId);
  });

  it("rejects renaming, deleting or staffing another tenant's department", async () => {
    await expect(renameDepartment(a.owner, { id: b.departmentId, name: "Hijacked" })).rejects.toThrow(NotFoundError);
    await expect(deleteDepartment(a.owner, { id: b.departmentId })).rejects.toThrow(NotFoundError);
    await expect(
      addDepartmentMember(a.owner, { departmentId: b.departmentId, userId: a.memberId }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      removeDepartmentMember(a.owner, { departmentId: b.departmentId, userId: b.memberId }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      addDepartmentMember(a.owner, { departmentId: a.departmentId, userId: b.memberId }),
    ).rejects.toThrow(NotFoundError);
  });

  it("rejects staffing another tenant's job or filing under its department", async () => {
    await expect(assignToJob(a.owner, { jobId: b.jobId, userId: a.memberId })).rejects.toThrow(NotFoundError);
    await expect(assignToJob(a.owner, { jobId: a.jobId, userId: b.memberId })).rejects.toThrow(NotFoundError);
    await expect(unassignFromJob(a.owner, { jobId: b.jobId, userId: b.viewer.actorId })).rejects.toThrow(
      NotFoundError,
    );
    await expect(setJobDepartment(a.owner, { jobId: b.jobId, departmentId: null })).rejects.toThrow(NotFoundError);
    await expect(
      setJobDepartment(a.owner, { jobId: a.jobId, departmentId: b.departmentId }),
    ).rejects.toThrow(NotFoundError);
  });

  it("rejects verifying, auto-joining or removing another tenant's domain", async () => {
    const published = async () => [[`resumerank-domain-verification=${b.domainId}`]];
    await expect(verifyDomain(a.owner, { domainId: b.domainId }, published)).rejects.toThrow(
      NotFoundError,
    );
    await expect(
      setDomainAutoJoin(a.owner, { domainId: b.domainId, autoJoin: false }),
    ).rejects.toThrow(NotFoundError);
    await expect(removeDomain(a.owner, { domainId: b.domainId })).rejects.toThrow(NotFoundError);
  });

  it("leaves every row of the other tenant exactly as it was", async () => {
    expect(await snapshot(b)).toEqual(bBefore);
  });
});
