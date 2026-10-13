import { randomUUID } from "node:crypto";

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
import { createCandidate, getCandidate, listCandidates } from "../../src/services/candidates";
import type { TenantContext } from "../../src/services/context";
import { getDashboardData } from "../../src/services/dashboard";
import { addDepartmentMember, createDepartment, deleteDepartment } from "../../src/services/departments";
import { ForbiddenError, NotFoundError } from "../../src/services/errors";
import { assignToJob, getHiringTeam, setJobDepartment, unassignFromJob } from "../../src/services/hiring-team";
import { createJob, getJob, listJobs, updateJob } from "../../src/services/jobs";
import { upsertScorecard } from "../../src/services/scorecards";
import { getJobScoringProgress, getScoringRun, requestScoring } from "../../src/services/scoring";
import { removeMember } from "../../src/services/team";
import { jobCreateSchema, jobUpdateSchema } from "../../src/validators/job";
import {
  applicationListParamsSchema,
  candidateListParamsSchema,
  jobListParamsSchema,
} from "../../src/validators/search";
import { createTenant, destroyTenant, RESUME_TEXT, type TenantFixture } from "./fixtures";

let t: TenantFixture;
let manager: TenantContext;
let interviewer: TenantContext;
/** A second job, its candidate and application: assigned to nobody restricted. */
let otherJobId: string;
let otherCandidateId: string;
let otherApplicationId: string;

async function addPerson(role: "HIRING_MANAGER" | "INTERVIEWER"): Promise<TenantContext> {
  const tag = randomUUID().slice(0, 8);
  const user = await db.user.create({
    data: { name: `${role} ${tag}`, email: `${role.toLowerCase()}-${tag}@example.test`, role, companyId: t.companyId },
  });
  t.userIds.push(user.id);
  return { companyId: t.companyId, actorId: user.id, role };
}

beforeAll(async () => {
  t = await createTenant("rbac");
  manager = await addPerson("HIRING_MANAGER");
  interviewer = await addPerson("INTERVIEWER");

  const job = await createJob(
    t.owner,
    jobCreateSchema.parse({
      title: "Data Engineer",
      description: "Build the pipelines that keep the hiring analytics fresh and correct.",
      employmentType: "FULL_TIME",
      status: "OPEN",
      requirements: [{ label: "SQL", weight: "MUST" }],
    }),
  );
  const candidate = await createCandidate(t.owner, {
    name: "Other Candidate",
    email: `other-${randomUUID().slice(0, 8)}@example.test`,
    source: "MANUAL",
    resumeText: RESUME_TEXT,
  });
  const application = await createApplication(t.owner, { jobId: job.id, candidateId: candidate.id });
  otherJobId = job.id;
  otherCandidateId = candidate.id;
  otherApplicationId = application.id;

  // The manager reaches the fixture job directly; the interviewer through its department.
  await assignToJob(t.owner, { jobId: t.jobId, userId: manager.actorId });
  await addDepartmentMember(t.owner, { departmentId: t.departmentId, userId: interviewer.actorId });
});

afterAll(async () => {
  if (t) await destroyTenant(t);
  await db.$disconnect();
});

describe("restricted roles reach only their jobs", () => {
  it("lists and opens only assigned jobs", async () => {
    for (const ctx of [manager, interviewer]) {
      const jobs = await listJobs(ctx, jobListParamsSchema.parse({}));
      expect(jobs.items.map((job) => job.id)).toEqual([t.jobId]);
      expect(await getJob(ctx, otherJobId)).toBeNull();
      expect((await getJob(ctx, t.jobId))?.id).toBe(t.jobId);
    }
  });

  it("sees candidates only through applications on those jobs", async () => {
    const candidates = await listCandidates(manager, candidateListParamsSchema.parse({}));
    expect(candidates.items.map((c) => c.id)).toEqual([t.candidateId]);
    expect(await getCandidate(manager, otherCandidateId)).toBeNull();
    expect((await getCandidate(interviewer, t.candidateId))?.resumeText).toBe(RESUME_TEXT);
  });

  it("treats other jobs' applications as missing", async () => {
    expect(await getApplication(manager, otherApplicationId)).toBeNull();
    const page = await listApplicationsForJob(manager, otherJobId, applicationListParamsSchema.parse({}));
    expect(page.items).toEqual([]);
    await expect(updateStage(manager, { id: otherApplicationId, stage: "SCREENING" })).rejects.toThrow(
      NotFoundError,
    );
    await expect(upsertScorecard(interviewer, { applicationId: otherApplicationId, rating: 2 })).rejects.toThrow(
      NotFoundError,
    );
    await expect(requestScoring(manager, otherApplicationId)).rejects.toThrow(NotFoundError);
    expect(await getHiringTeam(manager, otherJobId)).toBeNull();
  });

  it("scopes the dashboard to their jobs and leaves out the activity feed", async () => {
    const { stats, recentActivity } = await getDashboardData(manager);
    expect(stats).toMatchObject({ totalJobs: 1, totalCandidates: 1, activeApplications: 1 });
    expect(recentActivity).toEqual([]);
    await expect(listActivity(manager, {})).rejects.toThrow(ForbiddenError);
  });
});

describe("hiring managers", () => {
  it("edit their job and move stages, but can't attach, remove or staff", async () => {
    await expect(updateStage(manager, { id: t.applicationId, stage: "SCREENING" })).resolves.toMatchObject({
      stage: "SCREENING",
    });
    const job = await getJob(manager, t.jobId);
    if (!job) throw new Error("fixture job missing");
    const updated = await updateJob(
      manager,
      jobUpdateSchema.parse({
        id: job.id,
        title: job.title,
        description: job.description,
        employmentType: job.employmentType,
        status: job.status,
        requirements: job.requirements.map(({ id, label, weight }) => ({ id, label, weight })),
      }),
    );
    expect(updated.id).toBe(t.jobId);

    await expect(createApplication(manager, { jobId: t.jobId, candidateId: otherCandidateId })).rejects.toThrow(
      ForbiddenError,
    );
    await expect(setApplicationRemoved(manager, t.applicationId, true)).rejects.toThrow(ForbiddenError);
    await expect(assignToJob(manager, { jobId: t.jobId, userId: interviewer.actorId })).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("see scores and every scorecard", async () => {
    const application = await getApplication(manager, t.applicationId);
    expect(application?.aiScore).toBe(50);
    expect(application?.evaluations.length).toBeGreaterThan(0);
    expect(application?.scorecards.map((s) => s.reviewer.id)).toContain(t.owner.actorId);
  });
});

describe("interviewers rate blind", () => {
  it("get the application without any AI output", async () => {
    const application = await getApplication(interviewer, t.applicationId);
    expect(application).toMatchObject({ aiScore: null, aiSummary: null, scoredAt: null, evaluations: [] });
    expect(application?.scoring).toEqual({ active: null, lastFailure: null, history: [], injectionSignals: [] });
    expect(await getScoringRun(interviewer, t.scoringRunId)).toBeNull();
    expect(await getJobScoringProgress(interviewer, t.jobId)).toBeNull();

    const page = await listApplicationsForJob(interviewer, t.jobId, applicationListParamsSchema.parse({}));
    expect(page.items.map((item) => item.aiScore)).toEqual([null]);
    const candidate = await getCandidate(interviewer, t.candidateId);
    expect(candidate?.applications.map((a) => a.aiScore)).toEqual([null]);
    const { stats, scoreDistribution } = await getDashboardData(interviewer);
    expect(stats.averageScore).toBeNull();
    expect(scoreDistribution.every((bucket) => bucket.count === 0)).toBe(true);
  });

  it("see only their own scorecard after submitting it", async () => {
    expect((await getApplication(interviewer, t.applicationId))?.scorecards).toEqual([]);
    await upsertScorecard(interviewer, { applicationId: t.applicationId, rating: 3 });
    const scorecards = (await getApplication(interviewer, t.applicationId))?.scorecards ?? [];
    expect(scorecards.map((s) => s.reviewer.id)).toEqual([interviewer.actorId]);
  });

  it("can't move stages or request scoring", async () => {
    await expect(updateStage(interviewer, { id: t.applicationId, stage: "OFFER" })).rejects.toThrow(ForbiddenError);
    await expect(requestScoring(interviewer, t.applicationId)).rejects.toThrow(ForbiddenError);
  });
});

describe("access follows assignments", () => {
  it("lists the job's own team before its department's", async () => {
    const team = await getHiringTeam(t.owner, t.jobId);
    expect(team?.members.filter((m) => m.via === "job").map((m) => m.userId).sort()).toEqual(
      [t.viewer.actorId, manager.actorId].sort(),
    );
    expect(team?.members.filter((m) => m.via === "department").map((m) => m.userId).sort()).toEqual(
      [t.memberId, interviewer.actorId].sort(),
    );
  });

  it("ends when the job leaves the department, and returns when it's filed again", async () => {
    await setJobDepartment(t.owner, { jobId: t.jobId, departmentId: null });
    expect(await getJob(interviewer, t.jobId)).toBeNull();
    await setJobDepartment(t.owner, { jobId: t.jobId, departmentId: t.departmentId });
    expect((await getJob(interviewer, t.jobId))?.id).toBe(t.jobId);
  });

  it("ends with the department", async () => {
    const department = await createDepartment(t.owner, { name: `Temporary ${randomUUID().slice(0, 8)}` });
    await addDepartmentMember(t.owner, { departmentId: department.id, userId: interviewer.actorId });
    await setJobDepartment(t.owner, { jobId: otherJobId, departmentId: department.id });
    expect((await getJob(interviewer, otherJobId))?.id).toBe(otherJobId);

    await deleteDepartment(t.owner, { id: department.id });
    expect(await getJob(interviewer, otherJobId)).toBeNull();
    expect((await db.job.findUniqueOrThrow({ where: { id: otherJobId } })).departmentId).toBeNull();
  });

  it("ends when the assignment is removed", async () => {
    await assignToJob(t.owner, { jobId: otherJobId, userId: manager.actorId });
    expect((await getJob(manager, otherJobId))?.id).toBe(otherJobId);
    await unassignFromJob(t.owner, { jobId: otherJobId, userId: manager.actorId });
    expect(await getJob(manager, otherJobId)).toBeNull();
  });

  it("ends when the person leaves the workspace", async () => {
    await removeMember(t.owner, { userId: manager.actorId });
    expect(await db.jobAssignment.count({ where: { userId: manager.actorId } })).toBe(0);
  });
});
