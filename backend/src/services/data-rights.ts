import { logActivity } from "../activity";
import { CANDIDATE_REF, referencedCandidateId, renderSummary } from "../audit/candidate-ref";
import { tenantDb, tenantTransaction } from "../tenant-db";
import type { CandidateRetentionInput } from "../validators/compliance";
import { assertCanAdmin, type TenantContext } from "./context";
import { listStageDecisions, type StageDecision } from "./decisions";
import { ForbiddenError, NotFoundError } from "./errors";

/**
 * A data-subject access export (GDPR Art. 15 and 20): everything the
 * workspace holds about one candidate, in a machine-readable form. Teammates
 * are third parties to the candidate, so their names are left out; the
 * decisions and ratings themselves are included.
 */
export interface CandidateDataExport {
  format: "resumerank.candidate-export/v1";
  exportedAt: string;
  controller: string;
  candidate: {
    id: string;
    name: string;
    email: string;
    headline: string | null;
    source: string;
    resumeText: string;
    aiNoticeAt: string | null;
    aiOptOutAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  resumeFiles: Array<{
    id: string;
    fileName: string;
    kind: string;
    sizeBytes: number;
    sha256: string;
    status: string;
    uploadedAt: string;
  }>;
  applications: Array<{
    id: string;
    job: { id: string; title: string };
    stage: string;
    appliedAt: string;
    removedAt: string | null;
    currentScore: number | null;
    selfIdentification: { sex: string | null; race: string | null; submittedAt: string } | null;
    decisions: Array<Omit<StageDecision, "actor" | "at"> & { at: string }>;
    ratings: Array<{ rating: number; notes: string | null; at: string }>;
    scoringRuns: Array<{
      id: string;
      status: string;
      model: string;
      promptVersion: string;
      redacted: boolean;
      requestedAt: string;
      finishedAt: string | null;
      score: number | null;
      summary: string | null;
      input: unknown;
      evaluations: Array<{
        requirement: string;
        weight: string;
        verdict: string;
        evidence: string | null;
        note: string;
      }>;
    }>;
  }>;
  activity: Array<{ action: string; summary: string; at: string }>;
}

const iso = (date: Date): string => date.toISOString();
const isoOrNull = (date: Date | null): string | null => (date ? date.toISOString() : null);

export async function exportCandidateData(ctx: TenantContext, candidateId: string): Promise<CandidateDataExport> {
  assertCanAdmin(ctx);
  const scoped = tenantDb(ctx);
  const candidate = await scoped.candidate.findFirst({
    where: { id: candidateId, companyId: ctx.companyId },
    include: {
      company: { select: { name: true } },
      resumeFiles: { orderBy: { createdAt: "asc" } },
      applications: {
        orderBy: { createdAt: "asc" },
        include: {
          job: { select: { id: true, title: true } },
          selfId: true,
          scorecards: { orderBy: { createdAt: "asc" }, select: { rating: true, notes: true, createdAt: true } },
          scoringRuns: {
            orderBy: { createdAt: "asc" },
            include: { evaluations: { orderBy: { createdAt: "asc" } } },
          },
        },
      },
    },
  });
  if (!candidate) throw new NotFoundError("This candidate no longer exists.");

  const applicationIds = candidate.applications.map((application) => application.id);
  const [decisions, activity] = await Promise.all([
    Promise.all(applicationIds.map((id) => listStageDecisions(ctx, id))),
    scoped.activityLog.findMany({
      where: {
        companyId: ctx.companyId,
        OR: [
          { entityType: "candidate", entityId: candidateId },
          { entityType: "application", entityId: { in: applicationIds } },
        ],
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { action: true, summary: true, entityType: true, entityId: true, metadata: true, createdAt: true },
    }),
  ]);

  const result: CandidateDataExport = {
    format: "resumerank.candidate-export/v1",
    exportedAt: new Date().toISOString(),
    controller: candidate.company.name,
    candidate: {
      id: candidate.id,
      name: candidate.name,
      email: candidate.email,
      headline: candidate.headline,
      source: candidate.source,
      resumeText: candidate.resumeText,
      aiNoticeAt: isoOrNull(candidate.aiNoticeAt),
      aiOptOutAt: isoOrNull(candidate.aiOptOutAt),
      createdAt: iso(candidate.createdAt),
      updatedAt: iso(candidate.updatedAt),
    },
    resumeFiles: candidate.resumeFiles.map((file) => ({
      id: file.id,
      fileName: file.fileName,
      kind: file.kind,
      sizeBytes: file.sizeBytes,
      sha256: file.sha256,
      status: file.status,
      uploadedAt: iso(file.createdAt),
    })),
    applications: candidate.applications.map((application, index) => ({
      id: application.id,
      job: application.job,
      stage: application.stage,
      appliedAt: iso(application.createdAt),
      removedAt: isoOrNull(application.deletedAt),
      currentScore: application.aiScore,
      selfIdentification: application.selfId
        ? { sex: application.selfId.sex, race: application.selfId.race, submittedAt: iso(application.selfId.submittedAt) }
        : null,
      decisions: (decisions[index] ?? []).map(({ actor: _actor, at, ...decision }) => ({ ...decision, at: iso(at) })),
      ratings: application.scorecards.map((card) => ({ rating: card.rating, notes: card.notes, at: iso(card.createdAt) })),
      scoringRuns: application.scoringRuns.map((run) => ({
        id: run.id,
        status: run.status,
        model: run.model,
        promptVersion: run.promptVersion,
        redacted: run.redacted,
        requestedAt: iso(run.createdAt),
        finishedAt: isoOrNull(run.finishedAt),
        score: run.aiScore,
        summary: run.aiSummary,
        input: run.input,
        evaluations: run.evaluations.map((evaluation) => ({
          requirement: evaluation.criterion,
          weight: evaluation.weight,
          verdict: evaluation.verdict,
          evidence: evaluation.evidenceStatus === "VERIFIED" ? evaluation.evidence : null,
          note: evaluation.note,
        })),
      })),
    })),
    activity: activity.map((entry) => ({
      action: entry.action,
      summary: renderSummary(entry.summary, referencedCandidateId(entry) === candidateId ? candidate.name : null),
      at: iso(entry.createdAt),
    })),
  };

  await tenantTransaction(ctx, (tx) =>
    logActivity(
      {
        companyId: ctx.companyId,
        actorId: ctx.actorId,
        action: "candidate.data_export",
        entityType: "candidate",
        entityId: candidateId,
        summary: `exported all data held about ${CANDIDATE_REF}`,
      },
      tx,
    ),
  );
  return result;
}

export interface CandidateRetention {
  retentionDays: number | null;
}

export async function getCandidateRetention(ctx: TenantContext): Promise<CandidateRetention> {
  assertCanAdmin(ctx);
  const company = await tenantDb(ctx).company.findUnique({
    where: { id: ctx.companyId },
    select: { candidateRetentionDays: true },
  });
  if (!company) throw new NotFoundError("Your company no longer exists.");
  return { retentionDays: company.candidateRetentionDays };
}

/** The next scheduled purge applies it; shortening it deletes candidates past the new period then. */
export async function setCandidateRetention(
  ctx: TenantContext,
  input: CandidateRetentionInput,
): Promise<CandidateRetention> {
  assertCanAdmin(ctx);
  if (ctx.role !== "OWNER") throw new ForbiddenError("Only an owner can change how long candidates are kept.");

  return tenantTransaction(ctx, async (tx) => {
    const company = await tx.company.update({
      where: { id: ctx.companyId },
      data: { candidateRetentionDays: input.retentionDays },
      select: { candidateRetentionDays: true },
    });
    await logActivity(
      {
        companyId: ctx.companyId,
        actorId: ctx.actorId,
        action: "company.candidate_retention",
        entityType: "company",
        entityId: ctx.companyId,
        summary:
          input.retentionDays === null
            ? "set candidates to be kept until deleted"
            : `set candidates to be deleted after ${input.retentionDays} days without activity`,
        metadata: { retentionDays: input.retentionDays },
      },
      tx,
    );
    return { retentionDays: company.candidateRetentionDays };
  });
}
