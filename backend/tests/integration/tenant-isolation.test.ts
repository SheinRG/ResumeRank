import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "../../src/db";
import { listActivity } from "../../src/services/activity";
import {
  createApplication,
  getApplication,
  listApplicationsForJob,
  setApplicationRemoved,
  updateStage,
} from "../../src/services/applications";
import {
  deleteCandidate,
  exportCandidatesCsv,
  getCandidate,
  listCandidates,
  searchCandidateOptions,
  updateCandidate,
} from "../../src/services/candidates";
import { getCompany } from "../../src/services/company";
import { getDashboardData } from "../../src/services/dashboard";
import { NotFoundError } from "../../src/services/errors";
import { getJob, listJobOptions, listJobs, setJobStatus, updateJob } from "../../src/services/jobs";
import { upsertScorecard } from "../../src/services/scorecards";
import { getSsoSettings, removeDomain, setDomainAutoJoin, verifyDomain } from "../../src/services/sso";
import { closeSso } from "../../src/sso/jackson";
import {
  getJobScoringProgress,
  getScoringRun,
  requestJobScoring,
  requestScoring,
} from "../../src/services/scoring";
import {
  listPendingInvites,
  listTeam,
  removeMember,
  revokeInvite,
  updateMemberRole,
} from "../../src/services/team";
import { candidateUpdateSchema } from "../../src/validators/candidate";
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
  const [job, candidate, application, member, invite, domain, activityCount] = await Promise.all([
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
    db.companyInvite.findUnique({ where: { id: tenant.inviteId } }),
    db.companyDomain.findUnique({ where: { id: tenant.domainId } }),
    db.activityLog.count({ where: { companyId: tenant.companyId } }),
  ]);
  return { job, candidate, application, member, invite, domain, activityCount };
}

let a: TenantFixture;
let b: TenantFixture;
let bBefore: Awaited<ReturnType<typeof snapshot>>;

beforeAll(async () => {
  [a, b] = await Promise.all([createTenant("iso-a"), createTenant("iso-b")]);
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

  it("lists only the caller's SSO domains", async () => {
    const settings = await getSsoSettings(a.owner);
    expect(settings.domains.map((d) => d.id)).toEqual([a.domainId]);
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

  it("rejects role changes, removal and invite revocation", async () => {
    await expect(
      updateMemberRole(a.owner, { userId: b.memberId, role: "ADMIN" }),
    ).rejects.toThrow(NotFoundError);
    await expect(removeMember(a.owner, { userId: b.memberId })).rejects.toThrow(NotFoundError);
    await expect(revokeInvite(a.owner, b.inviteId)).rejects.toThrow(NotFoundError);
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
