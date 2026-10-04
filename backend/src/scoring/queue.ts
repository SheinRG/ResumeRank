import { db } from "../db";
import { logActivity } from "../activity";
import { tenantDb } from "../tenant-db";
import { errorFields, log, withLogContext } from "../observability/log";
import { DomainError } from "../services/errors";
import { MIN_RESUME_LENGTH } from "../validators/candidate";
import type { ScoringRun } from "../generated/prisma/client";
import {
  classifyProviderFailure,
  currentScoringSettings,
  requestEvaluation,
  scoringInputHash,
  type EvaluationOutcome,
  type ScoringJob,
} from "./engine";
import { computeScore } from "./math";

/**
 * Runs in flight at once, per tenant and overall. The per-tenant cap is also
 * the fairness rule: one company's 300-applicant bulk run can't occupy every
 * slot while another company waits.
 */
export const TENANT_CONCURRENCY = 2;
export const GLOBAL_CONCURRENCY = 8;
export const MAX_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 10_000;
const MAX_BACKOFF_MS = 5 * 60_000;
/** Longer than two bounded LLM attempts; a RUNNING row older than this lost its worker. */
export const STALE_RUN_MS = 3 * 60_000;
/**
 * Claiming stops after this. A run claimed at the last moment can take two
 * bounded LLM attempts (2 × 20s), so 15s + 40s still ends inside the 60s
 * `maxDuration` the draining routes declare.
 */
export const DEFAULT_DRAIN_BUDGET_MS = 15_000;
const DEFAULT_LANES = 3;

const GENERIC_FAILURE = "The AI provider returned an error. Try scoring again.";
const PROVIDER_UNAVAILABLE = "The AI provider is unavailable right now. Try scoring again later.";
const MISCONFIGURED =
  "AI scoring is misconfigured: the provider rejected the API key or model. Ask an admin to check GROQ_API_KEY and GROQ_MODEL.";

export type Evaluator = (job: ScoringJob, resumeText: string) => Promise<EvaluationOutcome>;

type ClaimedRun = Pick<ScoringRun, "id" | "companyId" | "applicationId" | "actorId" | "attempts" | "lockedAt">;

/** Exponential with ±20% jitter so a burst of 429s doesn't retry in lockstep. */
export function retryDelayMs(attempt: number, retryAfterMs: number | null, random = Math.random): number {
  const exponential = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (attempt - 1));
  const jittered = Math.round(exponential * (0.8 + random() * 0.4));
  return Math.max(jittered, retryAfterMs ?? 0);
}

/**
 * Takes the next due run, honouring both concurrency caps. A transaction-level
 * advisory lock serialises claimers across every instance, so the caps are
 * exact rather than best-effort; claims are a few milliseconds, so the lock is
 * never the bottleneck. The worker is a system process acting for many
 * tenants, so it uses the base client; each run's own reads and writes go
 * through that run's tenant-scoped client.
 */
export async function claimNextRun(now = new Date()): Promise<ClaimedRun | null> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('resumerank.scoring.claim'))`;

    const running = await tx.scoringRun.groupBy({
      by: ["companyId"],
      where: { status: "RUNNING" },
      _count: { _all: true },
    });
    const totalRunning = running.reduce((sum, group) => sum + group._count._all, 0);
    if (totalRunning >= GLOBAL_CONCURRENCY) return null;
    const saturated = running
      .filter((group) => group._count._all >= TENANT_CONCURRENCY)
      .map((group) => group.companyId);

    const next = await tx.scoringRun.findFirst({
      where: { status: "QUEUED", nextAttemptAt: { lte: now }, companyId: { notIn: saturated } },
      orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    if (!next) return null;

    return tx.scoringRun.update({
      where: { id: next.id },
      data: { status: "RUNNING", lockedAt: now, attempts: { increment: 1 } },
      select: {
        id: true,
        companyId: true,
        applicationId: true,
        actorId: true,
        attempts: true,
        lockedAt: true,
      },
    });
  });
}

/**
 * A worker killed mid-run (function timeout, deploy) leaves its row RUNNING
 * forever. Those rows go back to the queue, or fail once out of attempts.
 */
export async function recoverStaleRuns(now = new Date()): Promise<number> {
  const staleBefore = new Date(now.getTime() - STALE_RUN_MS);
  const [requeued, failed] = await db.$transaction([
    db.scoringRun.updateMany({
      where: { status: "RUNNING", lockedAt: { lt: staleBefore }, attempts: { lt: MAX_ATTEMPTS } },
      data: { status: "QUEUED", lockedAt: null, nextAttemptAt: now },
    }),
    db.scoringRun.updateMany({
      where: { status: "RUNNING", lockedAt: { lt: staleBefore }, attempts: { gte: MAX_ATTEMPTS } },
      data: { status: "FAILED", lockedAt: null, finishedAt: now, error: PROVIDER_UNAVAILABLE },
    }),
  ]);
  const recovered = requeued.count + failed.count;
  if (recovered > 0) {
    log.warn("scoring.stale_runs", { requeued: requeued.count, failed: failed.count });
  }
  return recovered;
}

/** Only the claim that is still current may finish a run; a recovered-and-reclaimed run belongs to its new worker. */
function ownedBy(run: ClaimedRun) {
  return { id: run.id, status: "RUNNING" as const, lockedAt: run.lockedAt };
}

async function failRun(run: ClaimedRun, message: string): Promise<void> {
  await tenantDb(run).scoringRun.updateMany({
    where: ownedBy(run),
    data: { status: "FAILED", lockedAt: null, finishedAt: new Date(), error: message },
  });
  log.warn("scoring.run_failed", { runId: run.id, attempts: run.attempts, reason: message });
}

async function retryOrFail(run: ClaimedRun, error: unknown): Promise<void> {
  const failure = classifyProviderFailure(error);
  if (!failure.retryable) {
    log.error("scoring.run_error", { runId: run.id, ...errorFields(error) });
    const message = failure.misconfigured
      ? MISCONFIGURED
      : error instanceof DomainError
        ? error.message
        : GENERIC_FAILURE;
    await failRun(run, message);
    return;
  }
  if (run.attempts >= MAX_ATTEMPTS) {
    await failRun(run, PROVIDER_UNAVAILABLE);
    return;
  }
  const delayMs = retryDelayMs(run.attempts, failure.retryAfterMs);
  await tenantDb(run).scoringRun.updateMany({
    where: ownedBy(run),
    data: { status: "QUEUED", lockedAt: null, nextAttemptAt: new Date(Date.now() + delayMs) },
  });
  log.warn("scoring.run_retry", { runId: run.id, attempts: run.attempts, delayMs, ...errorFields(error) });
}

/**
 * Scores one claimed run against the application's current inputs and
 * commits the run, its evaluations, the application's latest-run pointer and
 * the audit row together.
 */
export async function processRun(run: ClaimedRun, evaluate: Evaluator = requestEvaluation): Promise<void> {
  const scoped = tenantDb(run);
  const application = await scoped.application.findUnique({
    where: { id: run.applicationId },
    select: {
      deletedAt: true,
      candidate: { select: { name: true, resumeText: true } },
      job: {
        select: {
          title: true,
          description: true,
          requirements: { orderBy: { order: "asc" }, select: { id: true, label: true, weight: true } },
        },
      },
    },
  });
  if (!application || application.deletedAt) {
    await failRun(run, "This application was removed before it could be scored.");
    return;
  }
  const { candidate, job } = application;
  if (candidate.resumeText.trim().length < MIN_RESUME_LENGTH) {
    await failRun(run, `Add at least ${MIN_RESUME_LENGTH} characters of resume text before scoring.`);
    return;
  }
  if (job.requirements.length === 0) {
    await failRun(run, "This job has no requirements yet. Add requirements to define the scoring rubric.");
    return;
  }

  let outcome: EvaluationOutcome;
  try {
    outcome = await evaluate(job, candidate.resumeText);
  } catch (error) {
    await retryOrFail(run, error);
    return;
  }

  const requirementById = new Map(job.requirements.map((r) => [r.id, r]));
  const aiScore = computeScore(
    outcome.result.evaluations.map((e) => ({
      verdict: e.verdict,
      weight: requirementById.get(e.requirementId)?.weight ?? "NICE",
    })),
  );
  const settings = currentScoringSettings();
  const finishedAt = new Date();

  await scoped.$transaction(async (tx) => {
    const { count } = await tx.scoringRun.updateMany({
      where: ownedBy(run),
      data: {
        status: "SUCCEEDED",
        lockedAt: null,
        finishedAt,
        error: null,
        model: outcome.model,
        inputHash: scoringInputHash(job, candidate.resumeText, { ...settings, model: outcome.model }),
        aiScore,
        aiSummary: outcome.result.summary,
        promptTokens: outcome.promptTokens,
        completionTokens: outcome.completionTokens,
        latencyMs: outcome.latencyMs,
        rawOutput: outcome.rawOutput,
      },
    });
    if (count === 0) {
      log.warn("scoring.run_superseded", { runId: run.id });
      return;
    }
    await tx.evaluation.createMany({
      data: outcome.result.evaluations.map((e) => {
        const requirement = requirementById.get(e.requirementId);
        return {
          scoringRunId: run.id,
          requirementId: e.requirementId,
          criterion: requirement?.label ?? "",
          weight: requirement?.weight ?? "NICE",
          verdict: e.verdict,
          evidence: e.evidence,
          note: e.note,
        };
      }),
    });
    await tx.application.update({
      where: { id: run.applicationId },
      data: {
        latestScoringRunId: run.id,
        aiScore,
        aiSummary: outcome.result.summary,
        scoredAt: finishedAt,
      },
    });
    await logActivity(
      {
        companyId: run.companyId,
        actorId: run.actorId,
        action: "application.score",
        entityType: "application",
        entityId: run.applicationId,
        summary: `scored ${candidate.name} at ${aiScore}`,
      },
      tx,
    );
  });
}

export interface DrainOptions {
  budgetMs?: number;
  lanes?: number;
  evaluate?: Evaluator;
}

/**
 * Works the queue until it is empty, the caps are full, or the time budget is
 * spent. Safe to call from anywhere and as often as wanted — after an
 * enqueue, from a status poll, from a cron — because claiming is atomic.
 */
export async function drainScoringQueue(options: DrainOptions = {}): Promise<{ processed: number }> {
  const { budgetMs = DEFAULT_DRAIN_BUDGET_MS, lanes = DEFAULT_LANES, evaluate } = options;
  const deadline = Date.now() + budgetMs;

  return withLogContext({ worker: "scoring" }, async () => {
    await recoverStaleRuns();
    let processed = 0;

    async function lane(): Promise<void> {
      while (Date.now() < deadline) {
        const run = await claimNextRun();
        if (!run) return;
        await withLogContext({ runId: run.id, companyId: run.companyId }, async () => {
          try {
            await processRun(run, evaluate);
          } catch (error) {
            log.error("scoring.run_crashed", errorFields(error));
            await retryOrFail(run, error);
          }
        });
        processed += 1;
      }
    }

    await Promise.all(Array.from({ length: lanes }, lane));
    if (processed > 0) log.info("scoring.drained", { processed });
    return { processed };
  });
}
