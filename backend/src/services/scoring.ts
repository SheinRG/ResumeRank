import { db } from "../db";
import { logActivity } from "../activity";
import { checkAiQuota } from "../rate-limit";
import { requestEvaluation } from "../scoring/engine";
import { computeScore } from "../scoring/math";
import { ScoringError } from "../scoring/parse";
import { MIN_RESUME_LENGTH } from "../validators/candidate";
import { assertCanWrite, type TenantContext } from "./context";
import { DomainError, NotFoundError } from "./errors";

export interface ScoreOutcome {
  aiScore: number;
  aiSummary: string;
  jobId: string;
  candidateId: string;
}

/**
 * Scores an application end to end and persists the result atomically:
 * either the full evaluation set, the score and its audit row all land, or
 * nothing changes. Every read and write is scoped to `ctx.companyId`.
 */
export async function scoreApplication(
  ctx: TenantContext,
  applicationId: string,
): Promise<ScoreOutcome> {
  assertCanWrite(ctx);
  const { companyId } = ctx;

  const application = await db.application.findUnique({
    where: { id: applicationId, companyId },
    select: {
      jobId: true,
      candidateId: true,
      deletedAt: true,
      candidate: { select: { name: true, resumeText: true } },
      job: {
        select: {
          title: true,
          description: true,
          requirements: {
            orderBy: { order: "asc" },
            select: { id: true, label: true, weight: true },
          },
        },
      },
    },
  });
  if (!application || application.deletedAt) {
    throw new NotFoundError("This application no longer exists.");
  }
  // Seeded data or a direct edit can leave a resume shorter than the form
  // allows; checking here avoids paying for a guaranteed rejection.
  if (application.candidate.resumeText.trim().length < MIN_RESUME_LENGTH) {
    throw new DomainError(
      `Add at least ${MIN_RESUME_LENGTH} characters of resume text before scoring.`,
    );
  }
  if (application.job.requirements.length === 0) {
    throw new ScoringError(
      "This job has no requirements yet. Add requirements to define the scoring rubric.",
    );
  }

  const overQuota = checkAiQuota({ userId: ctx.actorId, companyId });
  if (overQuota) throw new DomainError(overQuota);

  const { requirements } = application.job;
  const result = await requestEvaluation(
    {
      title: application.job.title,
      description: application.job.description,
      requirements,
    },
    application.candidate.resumeText,
  );

  const requirementById = new Map(requirements.map((r) => [r.id, r]));
  const aiScore = computeScore(
    result.evaluations.map((e) => ({
      verdict: e.verdict,
      weight: requirementById.get(e.requirementId)?.weight ?? "NICE",
    })),
  );

  await db.$transaction(async (tx) => {
    // The tenant-scoped update runs first: if the application has left the
    // tenant, it throws and the evaluation writes never happen.
    await tx.application.update({
      where: { id: applicationId, companyId },
      data: { aiScore, aiSummary: result.summary, scoredAt: new Date() },
    });
    await tx.evaluation.deleteMany({
      where: { applicationId, application: { companyId } },
    });
    await tx.evaluation.createMany({
      data: result.evaluations.map((e) => {
        const requirement = requirementById.get(e.requirementId);
        return {
          applicationId,
          requirementId: e.requirementId,
          criterion: requirement?.label ?? "",
          weight: requirement?.weight ?? "NICE",
          verdict: e.verdict,
          evidence: e.evidence,
          note: e.note,
        };
      }),
    });
    await logActivity(
      {
        companyId,
        actorId: ctx.actorId,
        action: "application.score",
        entityType: "application",
        entityId: applicationId,
        summary: `scored ${application.candidate.name} at ${aiScore}`,
      },
      tx,
    );
  });

  return {
    aiScore,
    aiSummary: result.summary,
    jobId: application.jobId,
    candidateId: application.candidateId,
  };
}
