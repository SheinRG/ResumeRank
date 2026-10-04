import { tenantDb } from "../tenant-db";
import { logActivity } from "../activity";
import type { Application, Prisma } from "../generated/prisma/client";
import type { CandidateSource, RequirementWeight, Stage, Verdict } from "../validators/enums";
import type { ApplicationCreateInput, ApplicationStageInput } from "../validators/application";
import { PAGE_SIZE, type ApplicationListParams } from "../validators/search";
import type { Paged } from "../types/paged";
import { assertCanWrite, type TenantContext } from "./context";
import { ConflictError, DomainError, NotFoundError } from "./errors";
import { isPrismaError } from "./prisma-errors";
import { resolvePageWindow } from "./pagination";
import type { JobDetail } from "./jobs";

const APPLICATION_NOT_FOUND = "This application no longer exists.";

export interface ApplicationListItem {
  id: string;
  stage: Stage;
  aiScore: number | null;
  scoredAt: Date | null;
  createdAt: Date;
  candidate: { id: string; name: string; email: string; headline: string | null };
  evaluationCounts: { strong: number; partial: number; missing: number };
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
  resumeText: string;
  createdAt: Date;
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
}

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

function buildApplicationOrderBy(
  sort: ApplicationListParams["sort"],
): Prisma.ApplicationOrderByWithRelationInput[] {
  if (sort === "newest") return [{ createdAt: "desc" }, { id: "asc" }];
  if (sort === "oldest") return [{ createdAt: "asc" }, { id: "asc" }];
  return [{ aiScore: { sort: "desc", nulls: "last" } }, { id: "asc" }];
}

export async function listApplicationsForJob(
  ctx: TenantContext,
  jobId: string,
  params: ApplicationListParams,
): Promise<Paged<ApplicationListItem>> {
  const where = buildApplicationWhere(ctx.companyId, jobId, params);
  const total = await tenantDb(ctx).application.count({ where });
  const { pageCount, skip, take, effectivePage, overflow } = resolvePageWindow(params.page, total);

  if (overflow) {
    return { items: [], total, page: effectivePage, pageSize: PAGE_SIZE, pageCount };
  }

  const applications = await tenantDb(ctx).application.findMany({
    where,
    orderBy: buildApplicationOrderBy(params.sort),
    skip,
    take,
    select: {
      id: true,
      stage: true,
      aiScore: true,
      scoredAt: true,
      createdAt: true,
      candidate: { select: { id: true, name: true, email: true, headline: true } },
    },
  });

  const applicationIds = applications.map((a) => a.id);
  const verdictGroups = applicationIds.length
    ? await tenantDb(ctx).evaluation.groupBy({
        by: ["applicationId", "verdict"],
        where: { applicationId: { in: applicationIds } },
        _count: { _all: true },
      })
    : [];

  const countsByApplication = new Map<
    string,
    { strong: number; partial: number; missing: number }
  >();
  for (const group of verdictGroups) {
    const entry = countsByApplication.get(group.applicationId) ?? {
      strong: 0,
      partial: 0,
      missing: 0,
    };
    if (group.verdict === "STRONG") entry.strong = group._count._all;
    else if (group.verdict === "PARTIAL") entry.partial = group._count._all;
    else entry.missing = group._count._all;
    countsByApplication.set(group.applicationId, entry);
  }

  const items: ApplicationListItem[] = applications.map((a) => ({
    id: a.id,
    stage: a.stage,
    aiScore: a.aiScore,
    scoredAt: a.scoredAt,
    createdAt: a.createdAt,
    candidate: a.candidate,
    evaluationCounts: countsByApplication.get(a.id) ?? {
      strong: 0,
      partial: 0,
      missing: 0,
    },
  }));

  return { items, total, page: effectivePage, pageSize: PAGE_SIZE, pageCount };
}

export async function getApplication(
  ctx: TenantContext,
  id: string,
): Promise<ApplicationDetail | null> {
  return tenantDb(ctx).application.findUnique({
    where: { id, companyId: ctx.companyId },
    include: {
      job: { include: { requirements: { orderBy: { order: "asc" } } } },
      candidate: true,
      evaluations: { orderBy: [{ requirement: { order: "asc" } }, { id: "asc" }] },
      scorecards: {
        orderBy: { createdAt: "desc" },
        include: { reviewer: { select: { id: true, name: true, image: true } } },
      },
    },
  });
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
