import { tenantDb, tenantTransaction, type TenantTx } from "../tenant-db";
import { logActivity } from "../activity";
import { CANDIDATE_REF } from "../audit/candidate-ref";
import { assertAiBudget } from "../ai-budget";
import { checkAiQuota } from "../rate-limit";
import {
  assertScoringConfigured,
  currentScoringSettings,
  scoringInputHash,
  ScoringError,
  type ScoringJob,
  type ScoringSettings,
} from "../scoring/engine";
import {
  SCORING_CANDIDATE_SELECT,
  SCORING_POLICY_SELECT,
  scoringRefusal,
  scoringResume,
  type ScoringPolicy,
} from "../scoring/policy";
import { MIN_RESUME_LENGTH } from "../validators/candidate";
import type { ScoringRunStatus } from "../validators/enums";
import { assertCan, type TenantContext } from "./context";
import { applicationAccessWhere, jobAccessWhere, seesScores } from "./access";
import { DomainError, NotFoundError } from "./errors";

/** Bounds one bulk request; the rest stay unscored for the next click. */
export const MAX_BULK_SCORING = 200;
const ACTIVE_STATUSES: ScoringRunStatus[] = ["QUEUED", "RUNNING"];
const APPLICATION_NOT_FOUND = "This application no longer exists.";

export interface ScoringRunView {
  id: string;
  applicationId: string;
  status: ScoringRunStatus;
  aiScore: number | null;
  error: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}

/** `reused`: inputs match an earlier successful run, so no LLM call was needed. */
export type ScoringRequestOutcome = "queued" | "in_progress" | "reused";

export interface ScoringRequestResult {
  outcome: ScoringRequestOutcome;
  run: ScoringRunView;
}

export interface JobScoringRequestResult {
  queued: number;
  alreadyQueued: number;
  /** Unscored applicants whose resume is too short to score. */
  skipped: number;
  /** Unscored applicants who opted out of AI scoring, or haven't had the notice the company requires. */
  excluded: number;
  /** Left for a later request because of MAX_BULK_SCORING. */
  remaining: number;
}

export interface JobScoringProgress {
  queued: number;
  running: number;
  unscored: number;
}

const RUN_VIEW_SELECT = {
  id: true,
  applicationId: true,
  status: true,
  aiScore: true,
  error: true,
  createdAt: true,
  finishedAt: true,
} as const;

/**
 * Row locks serialise concurrent requests for the same applications (two
 * clicks, a click racing a bulk request), so the "is a run already active?"
 * check below can't be raced into a duplicate run. Ids are locked in a fixed
 * order so overlapping requests can't deadlock.
 */
async function lockApplications(tx: TenantTx, companyId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Application"
    WHERE "id" = ANY(${[...ids].sort()}) AND "companyId" = ${companyId}
    ORDER BY "id"
    FOR UPDATE
  `;
  return new Set(rows.map((row) => row.id));
}

function scoringJobOf(job: {
  title: string;
  description: string;
  requirements: Array<{ id: string; label: string; weight: ScoringJob["requirements"][number]["weight"] }>;
}): ScoringJob {
  return { title: job.title, description: job.description, requirements: job.requirements };
}

const SCORING_INPUT_SELECT = {
  id: true,
  deletedAt: true,
  latestScoringRunId: true,
  candidateId: true,
  candidate: { select: SCORING_CANDIDATE_SELECT },
  job: {
    select: {
      id: true,
      title: true,
      description: true,
      requirements: {
        orderBy: { order: "asc" as const },
        select: { id: true, label: true, weight: true },
      },
    },
  },
};

function assertScorable(resumeText: string, requirementCount: number): void {
  if (resumeText.trim().length < MIN_RESUME_LENGTH) {
    throw new DomainError(
      `Add at least ${MIN_RESUME_LENGTH} characters of resume text before scoring.`,
    );
  }
  if (requirementCount === 0) {
    throw new ScoringError(
      "This job has no requirements yet. Add requirements to define the scoring rubric.",
    );
  }
}

async function scoringPolicy(tx: TenantTx, companyId: string): Promise<ScoringPolicy> {
  const policy = await tx.company.findUnique({ where: { id: companyId }, select: SCORING_POLICY_SELECT });
  if (!policy) throw new NotFoundError("This workspace no longer exists.");
  return policy;
}

async function quotaOrThrow(ctx: TenantContext, calls: number): Promise<void> {
  const overQuota = await checkAiQuota({ userId: ctx.actorId, companyId: ctx.companyId, calls });
  if (overQuota) throw new DomainError(overQuota);
}

/**
 * Queues an AI score for one application, or explains why none is needed:
 * a run already in flight is returned as-is, and inputs identical to an
 * earlier successful run (same resume, rubric, model and prompt) re-point the
 * application at that run instead of paying for the same answer twice.
 */
export async function requestScoring(
  ctx: TenantContext,
  applicationId: string,
): Promise<ScoringRequestResult> {
  assertCan(ctx, "scoring.request");
  assertScoringConfigured();
  const settings = currentScoringSettings();

  return tenantTransaction(ctx, async (tx) => {
    const locked = await lockApplications(tx, ctx.companyId, [applicationId]);
    if (!locked.has(applicationId)) throw new NotFoundError(APPLICATION_NOT_FOUND);

    const application = await tx.application.findFirst({
      where: { id: applicationId, ...applicationAccessWhere(ctx) },
      select: SCORING_INPUT_SELECT,
    });
    if (!application || application.deletedAt) throw new NotFoundError(APPLICATION_NOT_FOUND);
    assertScorable(application.candidate.resumeText, application.job.requirements.length);
    const policy = await scoringPolicy(tx, ctx.companyId);
    const refusal = scoringRefusal(application.candidate, policy);
    if (refusal) throw new DomainError(refusal);

    const active = await tx.scoringRun.findFirst({
      where: { applicationId, status: { in: ACTIVE_STATUSES } },
      select: RUN_VIEW_SELECT,
    });
    if (active) return { outcome: "in_progress", run: active };

    const inputHash = scoringInputHash(
      scoringJobOf(application.job),
      scoringResume(application.candidate, policy),
      settings,
    );
    const previous = await tx.scoringRun.findFirst({
      where: { applicationId, inputHash, status: "SUCCEEDED" },
      orderBy: { createdAt: "desc" },
      select: { ...RUN_VIEW_SELECT, aiSummary: true },
    });
    if (previous) {
      const { aiSummary, ...run } = previous;
      if (application.latestScoringRunId !== run.id) {
        await tx.application.update({
          where: { id: applicationId },
          data: {
            latestScoringRunId: run.id,
            aiScore: run.aiScore,
            aiSummary,
            scoredAt: run.finishedAt,
          },
        });
        await logActivity(
          {
            companyId: ctx.companyId,
            actorId: ctx.actorId,
            action: "application.score_reused",
            entityType: "application",
            entityId: applicationId,
            summary: `restored the earlier score of ${run.aiScore} for ${CANDIDATE_REF} (same inputs)`,
            metadata: { candidateId: application.candidateId },
          },
          tx,
        );
      }
      return { outcome: "reused", run };
    }

    await assertAiBudget(ctx.companyId);
    await quotaOrThrow(ctx, 1);
    const run = await tx.scoringRun.create({
      data: newRunData(ctx, applicationId, inputHash, settings),
      select: RUN_VIEW_SELECT,
    });
    await logActivity(
      {
        companyId: ctx.companyId,
        actorId: ctx.actorId,
        action: "application.score_requested",
        entityType: "application",
        entityId: applicationId,
        summary: `requested an AI score for ${CANDIDATE_REF}`,
        metadata: { candidateId: application.candidateId },
      },
      tx,
    );
    return { outcome: "queued", run };
  });
}

function newRunData(
  ctx: TenantContext,
  applicationId: string,
  inputHash: string,
  settings: ScoringSettings,
) {
  return {
    companyId: ctx.companyId,
    applicationId,
    actorId: ctx.actorId,
    model: settings.model,
    promptVersion: settings.promptVersion,
    temperature: settings.temperature,
    seed: settings.seed,
    inputHash,
  };
}

/** Queues every unscored, scorable applicant of a job in one request. */
export async function requestJobScoring(
  ctx: TenantContext,
  jobId: string,
): Promise<JobScoringRequestResult> {
  assertCan(ctx, "scoring.request");
  assertScoringConfigured();
  const settings = currentScoringSettings();

  return tenantTransaction(ctx, async (tx) => {
    const job = await tx.job.findFirst({
      where: { id: jobId, ...jobAccessWhere(ctx) },
      select: {
        id: true,
        title: true,
        description: true,
        requirements: {
          orderBy: { order: "asc" },
          select: { id: true, label: true, weight: true },
        },
      },
    });
    if (!job) throw new NotFoundError("This job no longer exists.");
    if (job.requirements.length === 0) {
      throw new ScoringError(
        "This job has no requirements yet. Add requirements to define the scoring rubric.",
      );
    }

    const unscored = await tx.application.findMany({
      where: { jobId, deletedAt: null, latestScoringRunId: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    const locked = await lockApplications(tx, ctx.companyId, unscored.map((a) => a.id));
    const candidates = await tx.application.findMany({
      where: { id: { in: [...locked] }, deletedAt: null, latestScoringRunId: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        candidate: { select: SCORING_CANDIDATE_SELECT },
        scoringRuns: { where: { status: { in: ACTIVE_STATUSES } }, select: { id: true } },
      },
    });

    const policy = await scoringPolicy(tx, ctx.companyId);
    const alreadyQueued = candidates.filter((a) => a.scoringRuns.length > 0).length;
    const idle = candidates.filter((a) => a.scoringRuns.length === 0);
    const permitted = idle.filter((a) => scoringRefusal(a.candidate, policy) === null);
    const scorable = permitted.filter((a) => a.candidate.resumeText.trim().length >= MIN_RESUME_LENGTH);
    const batch = scorable.slice(0, MAX_BULK_SCORING);
    const result: JobScoringRequestResult = {
      queued: batch.length,
      alreadyQueued,
      skipped: permitted.length - scorable.length,
      excluded: idle.length - permitted.length,
      remaining: scorable.length - batch.length,
    };
    if (batch.length === 0) return result;

    await assertAiBudget(ctx.companyId);
    await quotaOrThrow(ctx, batch.length);
    const scoringJob = scoringJobOf(job);
    await tx.scoringRun.createMany({
      data: batch.map((a) =>
        newRunData(ctx, a.id, scoringInputHash(scoringJob, scoringResume(a.candidate, policy), settings), settings),
      ),
    });
    await logActivity(
      {
        companyId: ctx.companyId,
        actorId: ctx.actorId,
        action: "job.score_requested",
        entityType: "job",
        entityId: job.id,
        summary: `queued AI scoring for ${batch.length} applicant${batch.length === 1 ? "" : "s"} of "${job.title}"`,
        metadata: { ...result },
      },
      tx,
    );
    return result;
  });
}

export async function getScoringRun(ctx: TenantContext, runId: string): Promise<ScoringRunView | null> {
  if (!seesScores(ctx)) return null;
  return tenantDb(ctx).scoringRun.findFirst({
    where: { id: runId, application: applicationAccessWhere(ctx) },
    select: RUN_VIEW_SELECT,
  });
}

export async function getJobScoringProgress(
  ctx: TenantContext,
  jobId: string,
): Promise<JobScoringProgress | null> {
  if (!seesScores(ctx)) return null;
  const scoped = tenantDb(ctx);
  const job = await scoped.job.findFirst({ where: { id: jobId, ...jobAccessWhere(ctx) }, select: { id: true } });
  if (!job) return null;

  const [groups, unscored] = await Promise.all([
    scoped.scoringRun.groupBy({
      by: ["status"],
      where: { status: { in: ACTIVE_STATUSES }, application: { jobId, deletedAt: null } },
      _count: { _all: true },
    }),
    scoped.application.count({ where: { jobId, deletedAt: null, latestScoringRunId: null } }),
  ]);
  const count = (status: ScoringRunStatus) =>
    groups.find((g) => g.status === status)?._count._all ?? 0;
  return { queued: count("QUEUED"), running: count("RUNNING"), unscored };
}
