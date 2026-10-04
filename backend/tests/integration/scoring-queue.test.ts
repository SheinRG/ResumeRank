import { randomUUID } from "node:crypto";
import { APIError, RateLimitError } from "groq-sdk";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "../../src/db";
import { AI_BUDGET_EXHAUSTED, chargeAiTokens, getAiBudget } from "../../src/ai-budget";
import { currentScoringSettings } from "../../src/scoring/engine";
import { ScoringError } from "../../src/scoring/parse";
import {
  claimNextRun,
  drainScoringQueue,
  MAX_ATTEMPTS,
  processRun,
  recoverStaleRuns,
  STALE_RUN_MS,
  type Evaluator,
} from "../../src/scoring/queue";
import {
  createApplication,
  getApplication,
  setApplicationRemoved,
} from "../../src/services/applications";
import { createCandidate, updateCandidate } from "../../src/services/candidates";
import { ForbiddenError } from "../../src/services/errors";
import { createJob } from "../../src/services/jobs";
import {
  getJobScoringProgress,
  requestJobScoring,
  requestScoring,
} from "../../src/services/scoring";
import { candidateCreateSchema, candidateUpdateSchema } from "../../src/validators/candidate";
import type { Verdict } from "../../src/validators/enums";
import { jobCreateSchema } from "../../src/validators/job";
import { createTenant, destroyTenant, RESUME_TEXT, type TenantFixture } from "./fixtures";

let a: TenantFixture;
let b: TenantFixture;

beforeAll(async () => {
  [a, b] = await Promise.all([createTenant("queue-a"), createTenant("queue-b")]);
});

afterAll(async () => {
  await Promise.all([a, b].filter(Boolean).map(destroyTenant));
  await db.$disconnect();
});

beforeEach(async () => {
  await db.rateLimitCounter.deleteMany({
    where: {
      OR: [
        { key: { contains: a.companyId } },
        { key: { contains: b.companyId } },
        { key: { contains: a.owner.actorId } },
        { key: { contains: b.owner.actorId } },
      ],
    },
  });
  await db.company.updateMany({
    where: { id: { in: [a.companyId, b.companyId] } },
    data: { aiTokenBudget: null },
  });
  // Each test starts with an empty queue for these tenants, so one test's
  // leftover runs can't be claimed by another's drain.
  await db.scoringRun.deleteMany({
    where: { companyId: { in: [a.companyId, b.companyId] }, status: { in: ["QUEUED", "RUNNING"] } },
  });
});

function fakeEvaluator(verdict: Verdict = "STRONG"): { evaluate: Evaluator; calls: string[] } {
  const calls: string[] = [];
  const evaluate: Evaluator = async (job, resumeText) => {
    calls.push(resumeText);
    return {
      result: {
        summary: `All ${verdict.toLowerCase()}.`,
        evaluations: job.requirements.map((r) => ({
          requirementId: r.id,
          verdict,
          evidence: null,
          note: "Fake note.",
        })),
      },
      model: currentScoringSettings().model,
      attempts: 1,
      promptTokens: 100,
      completionTokens: 20,
      latencyMs: 5,
      rawOutput: "{}",
    };
  };
  return { evaluate, calls };
}

function failingEvaluator(error: unknown): Evaluator {
  return async () => {
    throw error;
  };
}

async function addApplicant(
  tenant: TenantFixture,
  { resumeText = RESUME_TEXT, jobId = tenant.jobId }: { resumeText?: string; jobId?: string } = {},
): Promise<{ applicationId: string; candidateId: string }> {
  const tag = randomUUID().slice(0, 8);
  const input = candidateCreateSchema.parse({
    name: `Applicant ${tag}`,
    email: `applicant-${tag}@example.test`,
    source: "MANUAL",
    resumeText: RESUME_TEXT,
  });
  const candidate =
    resumeText === RESUME_TEXT
      ? await createCandidate(tenant.owner, input)
      : await db.candidate.create({
          data: { ...input, resumeText, companyId: tenant.companyId, createdById: tenant.owner.actorId },
        });
  const application = await createApplication(tenant.owner, { jobId, candidateId: candidate.id });
  return { applicationId: application.id, candidateId: candidate.id };
}

async function runOf(id: string) {
  return db.scoringRun.findUniqueOrThrow({ where: { id }, include: { evaluations: true } });
}

describe("requesting a score", () => {
  it("queues one run and returns it again while it is in flight", async () => {
    const { applicationId } = await addApplicant(a);
    const first = await requestScoring(a.owner, applicationId);
    expect(first.outcome).toBe("queued");
    expect(first.run).toMatchObject({ applicationId, status: "QUEUED" });

    const again = await requestScoring(a.owner, applicationId);
    expect(again).toMatchObject({ outcome: "in_progress", run: { id: first.run.id } });

    const stored = await runOf(first.run.id);
    expect(stored).toMatchObject({
      companyId: a.companyId,
      actorId: a.owner.actorId,
      ...currentScoringSettings(),
    });
    expect(stored.inputHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is refused to viewers", async () => {
    await expect(requestScoring(a.viewer, a.applicationId)).rejects.toThrow(ForbiddenError);
  });
});

describe("the worker", () => {
  it("scores a run and commits evaluations, pointer, score and audit row together", async () => {
    const { applicationId } = await addApplicant(a);
    const { run } = await requestScoring(a.owner, applicationId);
    const { evaluate, calls } = fakeEvaluator("STRONG");

    const { processed } = await drainScoringQueue({ evaluate, lanes: 1 });

    expect(processed).toBe(1);
    expect(calls).toHaveLength(1);
    const stored = await runOf(run.id);
    expect(stored).toMatchObject({
      status: "SUCCEEDED",
      aiScore: 100,
      attempts: 1,
      lockedAt: null,
      promptTokens: 100,
      completionTokens: 20,
      error: null,
    });
    expect(stored.evaluations).toHaveLength(2);

    const detail = await getApplication(a.owner, applicationId);
    expect(detail?.aiScore).toBe(100);
    expect(detail?.evaluations.map((e) => e.verdict)).toEqual(["STRONG", "STRONG"]);
    expect(detail?.scoring.active).toBeNull();
    expect(detail?.scoring.history).toEqual([
      expect.objectContaining({ id: run.id, current: true, aiScore: 100 }),
    ]);
    expect(
      await db.activityLog.count({
        where: { companyId: a.companyId, entityId: applicationId, action: "application.score" },
      }),
    ).toBe(1);
  });

  it("keeps earlier runs and their evaluations when an application is rescored", async () => {
    const { run } = await requestScoring(a.owner, a.applicationId);
    await drainScoringQueue({ evaluate: fakeEvaluator("MISSING").evaluate, lanes: 1 });

    const previous = await runOf(a.scoringRunId);
    expect(previous.status).toBe("SUCCEEDED");
    expect(previous.evaluations.map((e) => e.verdict)).toEqual(["PARTIAL", "PARTIAL"]);

    const detail = await getApplication(a.owner, a.applicationId);
    expect(detail?.aiScore).toBe(0);
    expect(detail?.scoring.history.map((h) => [h.id, h.current])).toEqual([
      [run.id, true],
      [a.scoringRunId, false],
    ]);
  });

  it("retries transient provider failures with backoff, then succeeds", async () => {
    const { applicationId } = await addApplicant(a);
    const { run } = await requestScoring(a.owner, applicationId);
    const rateLimited = new RateLimitError(
      429,
      undefined,
      "rate limited",
      new Headers({ "retry-after": "30" }),
    );

    await drainScoringQueue({ evaluate: failingEvaluator(rateLimited), lanes: 1 });
    const waiting = await runOf(run.id);
    expect(waiting).toMatchObject({ status: "QUEUED", attempts: 1, lockedAt: null, error: null });
    expect(waiting.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(Date.now() + 25_000);

    const notDue = await drainScoringQueue({ evaluate: fakeEvaluator().evaluate, lanes: 1 });
    expect(notDue.processed).toBe(0);

    await db.scoringRun.update({ where: { id: run.id }, data: { nextAttemptAt: new Date() } });
    await drainScoringQueue({ evaluate: fakeEvaluator().evaluate, lanes: 1 });
    expect(await runOf(run.id)).toMatchObject({ status: "SUCCEEDED", attempts: 2 });
  });

  it("fails permanently on errors that would repeat, and surfaces the reason", async () => {
    const { applicationId } = await addApplicant(a);
    const { run } = await requestScoring(a.owner, applicationId);
    const message = "The model kept returning malformed output. Try scoring again.";

    await drainScoringQueue({ evaluate: failingEvaluator(new ScoringError(message)), lanes: 1 });

    expect(await runOf(run.id)).toMatchObject({ status: "FAILED", error: message, lockedAt: null });
    const detail = await getApplication(a.owner, applicationId);
    expect(detail?.aiScore).toBeNull();
    expect(detail?.scoring.lastFailure?.error).toBe(message);
    expect(detail?.scoring.active).toBeNull();
  });

  it("tells the user when the provider rejects the configured model", async () => {
    const { applicationId } = await addApplicant(a);
    const { run } = await requestScoring(a.owner, applicationId);
    const unknownModel = new APIError(404, undefined, "model does not exist", new Headers());

    await drainScoringQueue({ evaluate: failingEvaluator(unknownModel), lanes: 1 });

    const stored = await runOf(run.id);
    expect(stored).toMatchObject({ status: "FAILED", attempts: 1 });
    expect(stored.error).toMatch(/GROQ_MODEL/);
  });

  it("gives up once a run is out of attempts", async () => {
    const { applicationId } = await addApplicant(a);
    const { run } = await requestScoring(a.owner, applicationId);
    await db.scoringRun.update({ where: { id: run.id }, data: { attempts: MAX_ATTEMPTS - 1 } });

    const unavailable = new APIError(503, undefined, "unavailable", new Headers());
    await drainScoringQueue({ evaluate: failingEvaluator(unavailable), lanes: 1 });

    expect(await runOf(run.id)).toMatchObject({ status: "FAILED", attempts: MAX_ATTEMPTS });
    expect((await runOf(run.id)).error).toMatch(/unavailable/);
  });

  it("fails a run whose application was removed after it was queued", async () => {
    const { applicationId } = await addApplicant(a);
    const { run } = await requestScoring(a.owner, applicationId);
    await setApplicationRemoved(a.owner, applicationId, true);
    const { evaluate, calls } = fakeEvaluator();

    await drainScoringQueue({ evaluate, lanes: 1 });

    expect(calls).toHaveLength(0);
    expect(await runOf(run.id)).toMatchObject({ status: "FAILED" });
    expect((await runOf(run.id)).error).toMatch(/removed/);
  });

  it("discards the result of a worker that lost its claim", async () => {
    const { applicationId } = await addApplicant(a);
    const { run } = await requestScoring(a.owner, applicationId);
    const claim = await claimNextRun();
    expect(claim?.id).toBe(run.id);
    if (!claim) return;
    await db.scoringRun.update({
      where: { id: run.id },
      data: { lockedAt: new Date(Date.now() + 1_000) },
    });

    await processRun(claim, fakeEvaluator().evaluate);

    const stored = await runOf(run.id);
    expect(stored.status).toBe("RUNNING");
    expect(stored.evaluations).toHaveLength(0);
    const application = await db.application.findUniqueOrThrow({ where: { id: applicationId } });
    expect(application.latestScoringRunId).toBeNull();
  });
});

describe("AI token budget", () => {
  it("charges each scored run's tokens to the company", async () => {
    const { applicationId } = await addApplicant(a);
    await requestScoring(a.owner, applicationId);
    await drainScoringQueue({ evaluate: fakeEvaluator().evaluate, lanes: 1 });
    expect((await getAiBudget(a.companyId)).used).toBe(120);
  });

  it("refuses new requests once the budget is spent", async () => {
    const [first, second] = await Promise.all([addApplicant(a), addApplicant(a)]);
    await db.company.update({ where: { id: a.companyId }, data: { aiTokenBudget: 100 } });
    await requestScoring(a.owner, first.applicationId);
    await drainScoringQueue({ evaluate: fakeEvaluator().evaluate, lanes: 1 });

    await expect(requestScoring(a.owner, second.applicationId)).rejects.toThrow(
      AI_BUDGET_EXHAUSTED,
    );
  });

  it("stops a queued batch when the budget runs out mid-way", async () => {
    const { applicationId } = await addApplicant(a);
    const { run } = await requestScoring(a.owner, applicationId);
    await db.company.update({ where: { id: a.companyId }, data: { aiTokenBudget: 1 } });
    await chargeAiTokens(a.companyId, 5);
    const { evaluate, calls } = fakeEvaluator();

    await drainScoringQueue({ evaluate, lanes: 1 });

    expect(calls).toHaveLength(0);
    expect(await runOf(run.id)).toMatchObject({ status: "FAILED", error: AI_BUDGET_EXHAUSTED });
  });
});

describe("claiming", () => {
  it("caps concurrent runs per tenant so other tenants are not starved", async () => {
    const applicantsA = await Promise.all([addApplicant(a), addApplicant(a), addApplicant(a)]);
    const applicantB = await addApplicant(b);
    const runsA = [];
    for (const { applicationId } of applicantsA) {
      runsA.push((await requestScoring(a.owner, applicationId)).run);
    }
    const runB = (await requestScoring(b.owner, applicantB.applicationId)).run;
    const now = Date.now();
    for (const [index, run] of runsA.entries()) {
      await db.scoringRun.update({
        where: { id: run.id },
        data: { nextAttemptAt: new Date(now - 10_000 + index * 1_000) },
      });
    }

    const claimed = [await claimNextRun(), await claimNextRun(), await claimNextRun()];
    expect(claimed.map((run) => run?.id)).toEqual([runsA[0].id, runsA[1].id, runB.id]);
    expect(await claimNextRun()).toBeNull();
  });

  it("returns runs abandoned by a dead worker to the queue, or fails them when out of attempts", async () => {
    const [first, second] = await Promise.all([addApplicant(a), addApplicant(b)]);
    const retryable = (await requestScoring(a.owner, first.applicationId)).run;
    const exhausted = (await requestScoring(b.owner, second.applicationId)).run;
    const deadSince = new Date(Date.now() - STALE_RUN_MS - 60_000);
    await db.scoringRun.update({
      where: { id: retryable.id },
      data: { status: "RUNNING", lockedAt: deadSince, attempts: 1 },
    });
    await db.scoringRun.update({
      where: { id: exhausted.id },
      data: { status: "RUNNING", lockedAt: deadSince, attempts: MAX_ATTEMPTS },
    });

    expect(await recoverStaleRuns()).toBe(2);
    expect(await runOf(retryable.id)).toMatchObject({ status: "QUEUED", lockedAt: null });
    expect(await runOf(exhausted.id)).toMatchObject({ status: "FAILED", lockedAt: null });
  });
});

describe("deduplication", () => {
  it("reuses an earlier result for identical inputs, and asks again when they change", async () => {
    const { applicationId, candidateId } = await addApplicant(a);
    const { run: original } = await requestScoring(a.owner, applicationId);
    await drainScoringQueue({ evaluate: fakeEvaluator("STRONG").evaluate, lanes: 1 });

    const unchanged = await requestScoring(a.owner, applicationId);
    expect(unchanged).toMatchObject({ outcome: "reused", run: { id: original.id } });

    const candidate = await db.candidate.findUniqueOrThrow({ where: { id: candidateId } });
    const edit = (resumeText: string) =>
      updateCandidate(
        a.owner,
        candidateUpdateSchema.parse({ ...candidate, headline: undefined, resumeText }),
      );
    await edit(`${RESUME_TEXT} Recently picked up Rust and Kubernetes.`);
    const changed = await requestScoring(a.owner, applicationId);
    expect(changed.outcome).toBe("queued");
    await drainScoringQueue({ evaluate: fakeEvaluator("MISSING").evaluate, lanes: 1 });
    expect((await getApplication(a.owner, applicationId))?.aiScore).toBe(0);

    await edit(RESUME_TEXT);
    const { evaluate, calls } = fakeEvaluator();
    const reverted = await requestScoring(a.owner, applicationId);
    await drainScoringQueue({ evaluate, lanes: 1 });

    expect(reverted).toMatchObject({ outcome: "reused", run: { id: original.id } });
    expect(calls).toHaveLength(0);
    const detail = await getApplication(a.owner, applicationId);
    expect(detail?.aiScore).toBe(100);
    expect(detail?.evaluations.map((e) => e.verdict)).toEqual(["STRONG", "STRONG"]);
    expect(
      await db.activityLog.count({
        where: { companyId: a.companyId, entityId: applicationId, action: "application.score_reused" },
      }),
    ).toBe(1);
  });
});

describe("bulk scoring", () => {
  it("queues each unscored, scorable applicant of a job once and reports progress", async () => {
    const job = await createJob(
      b.owner,
      jobCreateSchema.parse({
        title: "Bulk scoring job",
        description: "A job created only for the bulk scoring test.",
        employmentType: "FULL_TIME",
        status: "OPEN",
        requirements: [{ label: "TypeScript in production", weight: "MUST" }],
      }),
    );
    await Promise.all([addApplicant(b, { jobId: job.id }), addApplicant(b, { jobId: job.id })]);
    await addApplicant(b, { jobId: job.id, resumeText: "Too short to score." });

    const first = await requestJobScoring(b.owner, job.id);
    expect(first).toEqual({ queued: 2, alreadyQueued: 0, skipped: 1, remaining: 0 });
    expect(await getJobScoringProgress(b.owner, job.id)).toEqual({
      queued: 2,
      running: 0,
      unscored: 3,
    });

    const second = await requestJobScoring(b.owner, job.id);
    expect(second).toMatchObject({ queued: 0, alreadyQueued: 2 });

    await drainScoringQueue({ evaluate: fakeEvaluator().evaluate, lanes: 2 });
    expect(await getJobScoringProgress(b.owner, job.id)).toEqual({
      queued: 0,
      running: 0,
      unscored: 1,
    });
    expect(
      await db.activityLog.count({
        where: { companyId: b.companyId, entityId: job.id, action: "job.score_requested" },
      }),
    ).toBe(1);
  });
});
