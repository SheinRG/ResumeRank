import { tenantDb } from "../tenant-db";
import { logActivity } from "../activity";
import type { Application, Prisma } from "../generated/prisma/client";
import type {
  CandidateSource,
  RequirementWeight,
  ScoringRunStatus,
  Stage,
  Verdict,
} from "../validators/enums";
import type { ApplicationCreateInput, ApplicationStageInput } from "../validators/application";
import { PAGE_SIZE, type ApplicationListParams } from "../validators/search";
import type { Paged } from "../types/paged";
import { assertCanWrite, type TenantContext } from "./context";
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
import type { ScoringRunView } from "./scoring";

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
  evidence: string | null;
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
}

const SCORE_HISTORY_LIMIT = 10;

function buildApplicationWhere(
  companyId: string,
  jobId: string,
  params: ApplicationListParams,
): Prisma.ApplicationWhereInput {
  const q = params.q.trim();
  return {
    jobId,
    companyId,
    deletedAt: null,
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
  if (params.sort === "score") return keysetPage(scoreSort, params, fetch);
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
  const where = buildApplicationWhere(ctx.companyId, jobId, params);
  const [{ total, totalCapped }, page] = await Promise.all([
    countCapped((take) => tenantDb(ctx).application.count({ where, take })),
    listApplicationsPage(ctx, params, where),
  ]);
  const applications = page.items;

  const latestRunIds = applications.flatMap((a) =>
    a.latestScoringRunId ? [a.latestScoringRunId] : [],
  );
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
      aiScore: a.aiScore,
      scoredAt: a.scoredAt,
      createdAt: a.createdAt,
      candidate: a.candidate,
      evaluationCounts: (a.latestScoringRunId && countsByRun.get(a.latestScoringRunId)) || {
        strong: 0,
        partial: 0,
        missing: 0,
      },
      scoringStatus: activeStatus === "QUEUED" || activeStatus === "RUNNING" ? activeStatus : null,
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

export async function getApplication(
  ctx: TenantContext,
  id: string,
): Promise<ApplicationDetail | null> {
  const application = await tenantDb(ctx).application.findUnique({
    where: { id, companyId: ctx.companyId },
    include: {
      job: { include: { requirements: { orderBy: { order: "asc" } } } },
      candidate: {
        select: { id: true, name: true, email: true, headline: true, source: true, createdAt: true },
      },
      latestScoringRun: {
        select: {
          evaluations: { orderBy: [{ requirement: { order: "asc" } }, { id: "asc" }] },
        },
      },
      scorecards: {
        orderBy: { createdAt: "desc" },
        include: { reviewer: { select: { id: true, name: true, image: true } } },
      },
    },
  });
  if (!application) return null;

  const [active, mostRecent, succeeded, resume] = await Promise.all([
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
  ]);

  const { latestScoringRun, latestScoringRunId, candidate, ...rest } = application;
  return {
    ...rest,
    candidate: { ...candidate, resumeLength: resume[0]?.length ?? 0 },
    evaluations: latestScoringRun?.evaluations ?? [],
    scoring: {
      active,
      lastFailure:
        mostRecent?.status === "FAILED"
          ? { error: mostRecent.error ?? "Scoring failed.", finishedAt: mostRecent.finishedAt }
          : null,
      history: succeeded.map((run) => ({ ...run, current: run.id === latestScoringRunId })),
    },
  };
}

export async function createApplication(
  ctx: TenantContext,
  input: ApplicationCreateInput,
): Promise<Application> {
  assertCanWrite(ctx);
  const { jobId, candidateId } = input;

  const [job, candidate] = await Promise.all([
    tenantDb(ctx).job.findUnique({
      where: { id: jobId, companyId: ctx.companyId },
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
    return await tenantDb(ctx).$transaction(async (tx) => {
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
          summary: `attached ${candidate.name} to "${job.title}"`,
        },
        tx,
      );
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
  assertCanWrite(ctx);
  const { id, stage } = input;

  return tenantDb(ctx).$transaction(async (tx) => {
    const existing = await tx.application.findUnique({
      where: { id, companyId: ctx.companyId, deletedAt: null },
      select: { stage: true, candidate: { select: { name: true } } },
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
        summary: `moved ${existing.candidate.name} to ${stage}`,
        metadata: { from: existing.stage, to: stage },
      },
      tx,
    );
    return application;
  });
}

/** Soft delete keeps evaluations and scorecards so a restore brings the full history back. */
export async function setApplicationRemoved(
  ctx: TenantContext,
  id: string,
  removed: boolean,
): Promise<Application> {
  assertCanWrite(ctx);

  try {
    return await tenantDb(ctx).$transaction(async (tx) => {
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
            ? `removed ${candidate.name} from the pipeline`
            : `restored ${candidate.name} to the pipeline`,
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
