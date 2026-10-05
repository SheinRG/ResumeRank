import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "../../src/db";
import { listActivity } from "../../src/services/activity";
import { getApplication, listApplicationsForJob } from "../../src/services/applications";
import { listCandidates, searchCandidateOptions } from "../../src/services/candidates";
import { getDashboardData } from "../../src/services/dashboard";
import { getJob, updateJob } from "../../src/services/jobs";
import { COUNT_CAP } from "../../src/services/pagination";
import type { Paged } from "../../src/types/paged";
import { jobUpdateSchema } from "../../src/validators/job";
import {
  applicationListParamsSchema,
  candidateListParamsSchema,
  PAGE_SIZE,
} from "../../src/validators/search";
import { createTenant, destroyTenant, RESUME_TEXT, type TenantFixture } from "./fixtures";

const ROWS = PAGE_SIZE * 2 + 7;
const HOUR = 60 * 60 * 1000;

let t: TenantFixture;

/** Follows Next to the end, then Prev back to the start; both walks must agree. */
async function walk<T extends { id: string }>(
  list: (cursor: { after?: string; before?: string }) => Promise<Paged<T>>,
): Promise<{ forward: string[]; backward: string[] }> {
  const forward: string[] = [];
  let page = await list({});
  forward.push(...page.items.map((i) => i.id));
  while (page.nextCursor) {
    page = await list({ after: page.nextCursor });
    forward.push(...page.items.map((i) => i.id));
  }
  const backward: string[] = page.items.map((i) => i.id);
  while (page.prevCursor) {
    page = await list({ before: page.prevCursor });
    backward.unshift(...page.items.map((i) => i.id));
  }
  return { forward, backward };
}

beforeAll(async () => {
  t = await createTenant("data");
  const base = Date.now() - 10 * HOUR;

  // Pairs share a createdAt and names repeat, so every sort leans on its id tie-breaker.
  await db.candidate.createMany({
    data: Array.from({ length: ROWS }, (_, i) => ({
      name: `Person ${String(Math.floor(i / 3)).padStart(3, "0")}`,
      email: `person-${i}@example.test`,
      headline: i === 0 ? "Owns 100% of on-call" : null,
      resumeText:
        i === 1 ? `${RESUME_TEXT} Operated Kubernetes clusters at scale.` : RESUME_TEXT,
      companyId: t.companyId,
      createdById: t.owner.actorId,
      createdAt: new Date(base + Math.floor(i / 2) * 1000),
    })),
  });
  const people = await db.candidate.findMany({
    where: { companyId: t.companyId, email: { startsWith: "person-" } },
    select: { id: true },
  });
  // Scores repeat and some are missing, as a real pipeline's would.
  await db.application.createMany({
    data: people.map((p, i) => ({
      jobId: t.jobId,
      candidateId: p.id,
      companyId: t.companyId,
      createdById: t.owner.actorId,
      aiScore: i % 6 === 0 ? null : (i % 4) * 25,
    })),
  });
  await db.activityLog.createMany({
    data: Array.from({ length: COUNT_CAP + 5 }, (_, i) => ({
      companyId: t.companyId,
      actorId: t.owner.actorId,
      action: "test.event",
      entityType: "job",
      entityId: t.jobId,
      summary: `event ${i}`,
      createdAt: new Date(base + Math.floor(i / 2) * 1000),
    })),
  });
});

afterAll(async () => {
  if (t) await destroyTenant(t);
  await db.$disconnect();
});

describe("keyset pagination", () => {
  it("pages candidates newest-first without gaps or repeats", async () => {
    const expected = await db.candidate.findMany({
      where: { companyId: t.companyId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    const { forward, backward } = await walk((c) =>
      listCandidates(t.owner, candidateListParamsSchema.parse({ ...c })),
    );
    expect(forward).toEqual(expected.map((r) => r.id));
    expect(backward).toEqual(forward);
  });

  it("pages candidates by name, ties broken by id", async () => {
    const expected = await db.candidate.findMany({
      where: { companyId: t.companyId },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    const { forward, backward } = await walk((c) =>
      listCandidates(t.owner, candidateListParamsSchema.parse({ sort: "name", ...c })),
    );
    expect(forward).toEqual(expected.map((r) => r.id));
    expect(backward).toEqual(forward);
  });

  it("ranks applicants by score with unscored ones last, in both directions", async () => {
    const expected = await db.application.findMany({
      where: { jobId: t.jobId, deletedAt: null },
      orderBy: [{ aiScore: { sort: "desc", nulls: "last" } }, { id: "desc" }],
      select: { id: true },
    });
    const { forward, backward } = await walk((c) =>
      listApplicationsForJob(t.owner, t.jobId, applicationListParamsSchema.parse({ ...c })),
    );
    expect(forward).toEqual(expected.map((r) => r.id));
    expect(backward).toEqual(forward);
  });

  it("pages oldest-first applicants", async () => {
    const expected = await db.application.findMany({
      where: { jobId: t.jobId, deletedAt: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    const { forward } = await walk((c) =>
      listApplicationsForJob(
        t.owner,
        t.jobId,
        applicationListParamsSchema.parse({ sort: "oldest", ...c }),
      ),
    );
    expect(forward).toEqual(expected.map((r) => r.id));
  });

  it("caps the activity count and still reaches the oldest entry", async () => {
    const first = await listActivity(t.owner, { entityType: "job" });
    expect(first).toMatchObject({ total: COUNT_CAP, totalCapped: true, prevCursor: null });

    const expected = await db.activityLog.findMany({
      where: { companyId: t.companyId, entityType: "job" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    const { forward } = await walk((c) => listActivity(t.owner, { entityType: "job", ...c }));
    expect(forward).toEqual(expected.map((r) => r.id));
  });

  it("restarts at the first page when handed a garbage cursor", async () => {
    const first = await listCandidates(t.owner, candidateListParamsSchema.parse({}));
    const garbage = await listCandidates(
      t.owner,
      candidateListParamsSchema.parse({ after: "bm90LWEtY3Vyc29y" }),
    );
    expect(garbage.items.map((c) => c.id)).toEqual(first.items.map((c) => c.id));
  });
});

describe("candidate search", () => {
  it("finds words that only appear in the resume", async () => {
    const result = await listCandidates(
      t.owner,
      candidateListParamsSchema.parse({ q: "kubernetes" }),
    );
    expect(result.items.map((c) => c.email)).toEqual(["person-1@example.test"]);
    expect(result.total).toBe(1);
  });

  it("treats LIKE wildcards in the query literally", async () => {
    const percent = await listCandidates(t.owner, candidateListParamsSchema.parse({ q: "100%" }));
    expect(percent.items.map((c) => c.email)).toEqual(["person-0@example.test"]);

    const underscore = await listCandidates(t.owner, candidateListParamsSchema.parse({ q: "_" }));
    expect(underscore.items).toEqual([]);
  });

  it("offers a bounded set of attachable candidates matching the query", async () => {
    const otherJob = await db.job.create({
      data: {
        title: "Second job",
        description: "Another opening.",
        companyId: t.companyId,
        createdById: t.owner.actorId,
      },
    });
    const all = await searchCandidateOptions(t.owner, otherJob.id, { q: "" });
    expect(all).toHaveLength(20);

    const matched = await searchCandidateOptions(t.owner, otherJob.id, { q: "person-12@" });
    expect(matched.map((c) => c.email)).toEqual(["person-12@example.test"]);

    const alreadyAttached = await searchCandidateOptions(t.owner, t.jobId, { q: "person-12@" });
    expect(alreadyAttached).toEqual([]);
  });
});

describe("other data-layer paths", () => {
  it("buckets this week's applications in SQL", async () => {
    const { applicationsOverTime } = await getDashboardData(t.owner);
    const total = await db.application.count({
      where: { companyId: t.companyId, deletedAt: null },
    });
    const counted = applicationsOverTime.reduce((sum, week) => sum + week.count, 0);
    expect(counted).toBe(total);
    expect(applicationsOverTime).toHaveLength(8);
  });

  it("applies requirement edits, inserts, reorders and deletes in one update", async () => {
    const job = await getJob(t.owner, t.jobId);
    if (!job) throw new Error("fixture job missing");
    const [first, second] = job.requirements;

    const updated = await updateJob(
      t.owner,
      jobUpdateSchema.parse({
        id: job.id,
        title: job.title,
        description: job.description,
        employmentType: job.employmentType,
        status: job.status,
        requirements: [
          { label: "Brand new requirement", weight: "NICE" },
          { id: second.id, label: `${second.label} (edited)`, weight: "MUST" },
        ],
      }),
    );

    expect(
      updated.requirements.map((r) => ({ label: r.label, weight: r.weight, order: r.order })),
    ).toEqual([
      { label: "Brand new requirement", weight: "NICE", order: 0 },
      { label: `${second.label} (edited)`, weight: "MUST", order: 1 },
    ]);
    expect(updated.requirements[1].id).toBe(second.id);
    expect(await db.jobRequirement.findUnique({ where: { id: first.id } })).toBeNull();
  });

  it("reports the resume length without loading the resume", async () => {
    const application = await getApplication(t.owner, t.applicationId);
    expect(application?.candidate.resumeLength).toBe(RESUME_TEXT.trim().length);
    expect(application?.candidate).not.toHaveProperty("resumeText");
  });
});
