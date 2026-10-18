import { tenantDb, tenantTransaction } from "../tenant-db";
import { logActivity } from "../activity";
import { CANDIDATE_REF } from "../audit/candidate-ref";
import { can } from "../auth/roles";
import type { Application, Prisma } from "../generated/prisma/client";
import type {
  CandidateSource,
  EvidenceStatus,
  RequirementWeight,
  ScoringRunStatus,
  Stage,
  Verdict,
} from "../validators/enums";
import type { ApplicationCreateInput, ApplicationStageInput } from "../validators/application";
import { PAGE_SIZE, type ApplicationListParams } from "../validators/search";
import type { Paged } from "../types/paged";
import { assertCan, type TenantContext } from "./context";
import { applicationAccessWhere, jobAccessWhere, seesScores } from "./access";
import { ConflictError, DomainError, NotFoundError } from "./errors";
import { isPrismaError } from "./prisma-errors";
import {
  countCapped,
  createdAtSort,
  keysetPage,
  parseNullableNumberKey,
  past,
  type KeysetQuery,
  type KeysetSort,
} from "./pagination";
import type { JobDetail } from "./jobs";
import { applicationEventData } from "../webhooks/events";
import { queueWebhookEvent } from "../webhooks/outbox";
import type { ScoringRunView } from "./scoring";
import { decisionContext, listStageDecisions, type StageDecision } from "./decisions";

const APPLICATION_NOT_FOUND = "This application no longer exists.";

export interface ApplicationListItem {
  id: string;
  stage: Stage;
  aiScore: number | null;
  scoredAt: Date | null;
  createdAt: Date;
  candidate: { id: string; name: string; email: string; headline: string | null };
  evaluationCounts: { strong: number; partial: number; missing: number };
  /** Set while a run is queued or in flight, so the row can say so instead of "unscored". */
  scoringStatus: Extract<ScoringRunStatus, "QUEUED" | "RUNNING"> | null;
}

export interface EvaluationItem {
  id: string;
  requirementId: string | null;
  criterion: string;
  weight: RequirementWeight;
  verdict: Verdict;
  /** What the model answered, when the evidence rule capped it; null on older runs. */
  modelVerdict: Verdict | null;
  /** Only verified quotes are sent to the page; an unverified one is reported by status alone. */
  evidence: string | null;
  evidenceStatus: EvidenceStatus;
  note: string;
  createdAt: Date;
}

export interface ScorecardItem {
  id: string;
  rating: number;
  notes: string | null;
  createdAt: Date;
  reviewer: { id: string; name: string; image: string | null };
}

export interface ApplicationCandidateDetail {
  id: string;
  name: string;
  email: string;
  headline: string | null;
  source: CandidateSource;
  /** Trimmed resume length; the page only needs to know whether it's scorable, not the text. */
  resumeLength: number;
  aiNoticeAt: Date | null;
  aiOptOutAt: Date | null;
  createdAt: Date;
}

export interface ScoringHistoryItem {
  id: string;
  aiScore: number | null;
  model: string;
  finishedAt: Date | null;
  current: boolean;
}

export interface ApplicationScoring {
  active: ScoringRunView | null;
  /** The most recent run, when it failed after the current score was produced. */
  lastFailure: { error: string; finishedAt: Date | null } | null;
  history: ScoringHistoryItem[];
  /** Prompt-injection signals the current score's resume raised. */
  injectionSignals: string[];
}

export interface ApplicationDetail {
  id: string;
  stage: Stage;
  aiScore: number | null;
  aiSummary: string | null;
  scoredAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  job: JobDetail;
  candidate: ApplicationCandidateDetail;
  evaluations: EvaluationItem[];
  scorecards: ScorecardItem[];
  scoring: ApplicationScoring;
  /** The company requires the AI notice before a candidate is scored. */
  aiNoticeRequired: boolean;
  decisions: StageDecision[];
}

const SCORE_HISTORY_LIMIT = 10;

function buildApplicationWhere(
  ctx: TenantContext,
  jobId: string,
  params: ApplicationListParams,
): Prisma.ApplicationWhereInput {
  const q = params.q.trim();
  return {
    jobId,
    companyId: ctx.companyId,
    deletedAt: null,
    ...applicationAccessWhere(ctx),
    stage: params.stage,
    ...(q
      ? {
          candidate: {
            OR: [
              { name: { contains: q, mode: "insensitive" as const } },
              { email: { contains: q, mode: "insensitive" as const } },
            ],
          },
        }
      : {}),
  };
}

const applicationListSelect = {
  id: true,
  stage: true,
  aiScore: true,
  scoredAt: true,
  createdAt: true,
  latestScoringRunId: true,
  candidate: { select: { id: true, name: true, email: true, headline: true } },
  scoringRuns: {
    where: { status: { in: ["QUEUED", "RUNNING"] } },
    select: { status: true },
    take: 1,
  },
} satisfies Prisma.ApplicationSelect;

type ApplicationListRow = Prisma.ApplicationGetPayload<{ select: typeof applicationListSelect }>;
type ApplicationQuery = KeysetQuery<
  Prisma.ApplicationWhereInput,
  Prisma.ApplicationOrderByWithRelationInput[]
>;

/**
 * Highest score first, unscored last — so on the reversed scan a Prev page
 * takes, unscored rows come first and every scored row is "past" a null key.
 */
const scoreSort: KeysetSort<
  number | null,
  Prisma.ApplicationWhereInput,
  Prisma.ApplicationOrderByWithRelationInput[],
  ApplicationListRow
> = {
  direction: "desc",
  parseKey: parseNullableNumberKey,
  seekWhere: (key, id, scan) => {
    const nullsLast = scan === "desc";
    if (key === null) {
      return nullsLast
        ? { aiScore: null, id: past(scan, id) }
        : { OR: [{ aiScore: { not: null } }, { aiScore: null, id: past(scan, id) }] };
    }
    return {
      OR: [
        { aiScore: past(scan, key) },
        { aiScore: key, id: past(scan, id) },
        ...(nullsLast ? [{ aiScore: null }] : []),
      ],
    };
  },
  orderBy: (scan) => [
    { aiScore: { sort: scan, nulls: scan === "desc" ? "last" : "first" } },
    { id: scan },
  ],
  keyOf: (row) => row.aiScore,
};

function listApplicationsPage(
  ctx: TenantContext,
  params: ApplicationListParams,
  where: Prisma.ApplicationWhereInput,
) {
  const fetch = (query: ApplicationQuery) =>
    tenantDb(ctx).application.findMany({
      where: query.where ? { AND: [where, query.where] } : where,
      orderBy: query.orderBy,
      take: query.take,
      select: applicationListSelect,
    });
  // Ranking by score would reveal the scores to a role that may not see them.
  if (params.sort === "score" && seesScores(ctx)) return keysetPage(scoreSort, params, fetch);
  return keysetPage(
    createdAtSort<ApplicationListRow>(params.sort === "oldest" ? "asc" : "desc"),
    params,
    fetch,
  );
}

export async function listApplicationsForJob(
  ctx: TenantContext,
  jobId: string,
  params: ApplicationListParams,
): Promise<Paged<ApplicationListItem>> {
  const where = buildApplicationWhere(ctx, jobId, params);
  const scored = seesScores(ctx);
  const [{ total, totalCapped }, page] = await Promise.all([
    countCapped((take) => tenantDb(ctx).application.count({ where, take })),
    listApplicationsPage(ctx, params, where),
  ]);
  const applications = page.items;

  const latestRunIds = scored
    ? applications.flatMap((a) => (a.latestScoringRunId ? [a.latestScoringRunId] : []))
    : [];
  const verdictGroups = latestRunIds.length
    ? await tenantDb(ctx).evaluation.groupBy({
        by: ["scoringRunId", "verdict"],
        where: { scoringRunId: { in: latestRunIds } },
        _count: { _all: true },
      })
    : [];

  const countsByRun = new Map<string, { strong: number; partial: number; missing: number }>();
  for (const group of verdictGroups) {
    const entry = countsByRun.get(group.scoringRunId) ?? { strong: 0, partial: 0, missing: 0 };
    if (group.verdict === "STRONG") entry.strong = group._count._all;
    else if (group.verdict === "PARTIAL") entry.partial = group._count._all;
    else entry.missing = group._count._all;
    countsByRun.set(group.scoringRunId, entry);
  }

  const items: ApplicationListItem[] = applications.map((a) => {
    const activeStatus = a.scoringRuns[0]?.status;
    return {
      id: a.id,
      stage: a.stage,
      aiScore: scored ? a.aiScore : null,
      scoredAt: scored ? a.scoredAt : null,
      createdAt: a.createdAt,
      candidate: a.candidate,
      evaluationCounts: (a.latestScoringRunId && countsByRun.get(a.latestScoringRunId)) || {
        strong: 0,
        partial: 0,
        missing: 0,
      },
      scoringStatus: scored && (activeStatus === "QUEUED" || activeStatus === "RUNNING") ? activeStatus : null,
    };
  });

  return {
    items,
    total,
    totalCapped,
    pageSize: PAGE_SIZE,
    nextCursor: page.nextCursor,
    prevCursor: page.prevCursor,
  };
}

const HIDDEN_SCORING: ApplicationScoring = {
  active: null,
  lastFailure: null,
  history: [],
  injectionSignals: [],
};

/**
 * A role without `scoring.view` gets the application with every AI output
 * left out, and one without `scorecard.viewAll` only its own scorecard — so
 * neither ever reaches the page, rather than being hidden by it.
 */
export async function getApplication(
  ctx: TenantContext,
  id: string,
): Promise<ApplicationDetail | null> {
  const application = await tenantDb(ctx).application.findFirst({
    where: { id, companyId: ctx.companyId, ...applicationAccessWhere(ctx) },
    include: {
      job: {
        include: {
          requirements: { orderBy: { order: "asc" } },
          department: { select: { id: true, name: true } },
        },
      },
      candidate: {
        select: {
          id: true,
          name: true,
          email: true,
          headline: true,
          source: true,
          aiNoticeAt: true,
          aiOptOutAt: true,
          createdAt: true,
        },
      },
      company: { select: { aiNoticeRequired: true } },
      latestScoringRun: {
        select: {
          injectionSignals: true,
          evaluations: { orderBy: [{ requirement: { order: "asc" } }, { id: "asc" }] },
        },
      },
      scorecards: {
        where: can(ctx.role, "scorecard.viewAll") ? {} : { reviewerId: ctx.actorId },
        orderBy: { createdAt: "desc" },
        include: { reviewer: { select: { id: true, name: true, image: true } } },
      },
    },
  });
  if (!application) return null;

  const [active, mostRecent, succeeded, resume, decisions] = await Promise.all([
    tenantDb(ctx).scoringRun.findFirst({
      where: { applicationId: id, status: { in: ["QUEUED", "RUNNING"] } },
      select: {
        id: true,
        applicationId: true,
        status: true,
        aiScore: true,
        error: true,
        createdAt: true,
        finishedAt: true,
      },
    }),
    tenantDb(ctx).scoringRun.findFirst({
      where: { applicationId: id, status: { in: ["SUCCEEDED", "FAILED"] } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { status: true, error: true, finishedAt: true },
    }),
    tenantDb(ctx).scoringRun.findMany({
      where: { applicationId: id, status: "SUCCEEDED" },
      orderBy: [{ finishedAt: "desc" }, { id: "desc" }],
      take: SCORE_HISTORY_LIMIT,
      select: { id: true, aiScore: true, model: true, finishedAt: true },
    }),
    tenantDb(ctx).$queryRaw<Array<{ length: number }>>`
      SELECT char_length(btrim("resumeText", ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13)))::int AS length
      FROM "Candidate"
      WHERE "id" = ${application.candidateId} AND "companyId" = ${ctx.companyId}
    `,
    listStageDecisions(ctx, id),
  ]);

  const { latestScoringRun, latestScoringRunId, candidate, company, ...rest } = application;
  if (!seesScores(ctx)) {
    return {
      ...rest,
      aiScore: null,
      aiSummary: null,
      scoredAt: null,
      candidate: { ...candidate, resumeLength: resume[0]?.length ?? 0 },
      evaluations: [],
      scoring: HIDDEN_SCORING,
      aiNoticeRequired: company.aiNoticeRequired,
      decisions,
    };
  }
  return {
    ...rest,
    candidate: { ...candidate, resumeLength: resume[0]?.length ?? 0 },
    evaluations: (latestScoringRun?.evaluations ?? []).map((evaluation) => ({
      ...evaluation,
      evidence: evaluation.evidenceStatus === "VERIFIED" ? evaluation.evidence : null,
    })),
    scoring: {
      active,
      lastFailure:
        mostRecent?.status === "FAILED"
          ? { error: mostRecent.error ?? "Scoring failed.", finishedAt: mostRecent.finishedAt }
          : null,
      history: succeeded.map((run) => ({ ...run, current: run.id === latestScoringRunId })),
      injectionSignals: latestScoringRun?.injectionSignals ?? [],
    },
    aiNoticeRequired: company.aiNoticeRequired,
    decisions,
  };
}

export async function createApplication(
  ctx: TenantContext,
  input: ApplicationCreateInput,
): Promise<Application> {
  assertCan(ctx, "application.manage");
  const { jobId, candidateId } = input;

  const [job, candidate] = await Promise.all([
    tenantDb(ctx).job.findFirst({
      where: { id: jobId, companyId: ctx.companyId, ...jobAccessWhere(ctx) },
      select: { id: true, title: true, status: true },
    }),
    tenantDb(ctx).candidate.findUnique({
      where: { id: candidateId, companyId: ctx.companyId },
      select: { id: true, name: true },
    }),
  ]);
  if (!job) {
    throw new NotFoundError("Check the highlighted fields.", {
      jobId: ["That job no longer exists."],
    });
  }
  if (!candidate) {
    throw new NotFoundError("Check the highlighted fields.", {
      candidateId: ["That candidate no longer exists."],
    });
  }
  if (job.status === "ARCHIVED") {
    throw new DomainError("This job is archived — reopen it before adding applications.");
  }

  try {
    return await tenantTransaction(ctx, async (tx) => {
      const application = await tx.application.create({
        data: { jobId, candidateId, companyId: ctx.companyId, createdById: ctx.actorId },
      });
      await logActivity(
        {
          companyId: ctx.companyId,
          actorId: ctx.actorId,
          action: "application.create",
          entityType: "application",
          entityId: application.id,
          summary: `attached ${CANDIDATE_REF} to "${job.title}"`,
          metadata: { candidateId },
        },
        tx,
      );
      await queueWebhookEvent(tx, ctx.companyId, "application.created", applicationEventData(application));
      return application;
    });
  } catch (error) {
    if (isPrismaError(error, "P2002")) {
      throw new ConflictError("This candidate is already attached to this job.");
    }
    throw error;
  }
}

export async function updateStage(
  ctx: TenantContext,
  input: ApplicationStageInput,
): Promise<Application> {
  assertCan(ctx, "application.stage");
  const { id, stage } = input;

  return tenantTransaction(ctx, async (tx) => {
    const existing = await tx.application.findFirst({
      where: { id, companyId: ctx.companyId, deletedAt: null, ...applicationAccessWhere(ctx) },
      select: {
        stage: true,
        candidateId: true,
        latestScoringRun: {
          select: { id: true, aiScore: true, finishedAt: true, model: true, promptVersion: true },
        },
      },
    });
    if (!existing) throw new NotFoundError(APPLICATION_NOT_FOUND);

    const application = await tx.application.update({
      where: { id, companyId: ctx.companyId, deletedAt: null },
      data: { stage },
    });
    await logActivity(
      {
        companyId: ctx.companyId,
        actorId: ctx.actorId,
        action: "application.stage",
        entityType: "application",
        entityId: application.id,
        summary: `moved ${CANDIDATE_REF} to ${stage}`,
        metadata: {
          candidateId: existing.candidateId,
          from: existing.stage,
          to: stage,
          ai: decisionContext(ctx, existing.latestScoringRun),
        },
      },
      tx,
    );
    if (existing.stage !== stage) {
      await queueWebhookEvent(
        tx,
        ctx.companyId,
        "application.stage_changed",
        applicationEventData(application, { previousStage: existing.stage }),
      );
    }
    return application;
  });
}

/** Soft delete keeps evaluations and scorecards so a restore brings the full history back. */
export async function setApplicationRemoved(
  ctx: TenantContext,
  id: string,
  removed: boolean,
): Promise<Application> {
  assertCan(ctx, "application.manage");

  try {
    return await tenantTransaction(ctx, async (tx) => {
      const visible = await tx.application.findFirst({
        where: { id, companyId: ctx.companyId, ...applicationAccessWhere(ctx) },
        select: { id: true },
      });
      if (!visible) throw new NotFoundError(APPLICATION_NOT_FOUND);
      const { candidate, ...application } = await tx.application.update({
        where: { id, companyId: ctx.companyId },
        data: { deletedAt: removed ? new Date() : null },
        include: { candidate: { select: { name: true } } },
      });
      await logActivity(
        {
          companyId: ctx.companyId,
          actorId: ctx.actorId,
          action: removed ? "application.delete" : "application.restore",
          entityType: "application",
          entityId: application.id,
          summary: removed
            ? `removed ${CANDIDATE_REF} from the pipeline`
            : `restored ${CANDIDATE_REF} to the pipeline`,
          metadata: { candidateId: application.candidateId },
        },
        tx,
      );
      return application;
    });
  } catch (error) {
    if (isPrismaError(error, "P2025")) throw new NotFoundError(APPLICATION_NOT_FOUND);
    throw error;
  }
}
