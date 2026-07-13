import { db } from "@resumerank/core/db";
import { requireUser } from "@/lib/auth/guards";
import { PAGE_SIZE, type ApplicationListParams } from "@resumerank/core/validators/search";
import type {
  CandidateSource,
  RequirementWeight,
  Stage,
  Verdict,
} from "@resumerank/core/validators/enums";
import type { Prisma } from "@resumerank/core/generated/prisma/client";
import type { Paged } from "@resumerank/core/types/paged";
import { resolvePageWindow } from "./pagination";
import type { JobDetail } from "./jobs";

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
  jobId: string,
  params: ApplicationListParams,
): Prisma.ApplicationWhereInput {
  const q = params.q.trim();
  return {
    jobId,
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
  jobId: string,
  params: ApplicationListParams,
): Promise<Paged<ApplicationListItem>> {
  await requireUser();

  const where = buildApplicationWhere(jobId, params);
  const total = await db.application.count({ where });
  const { pageCount, skip, take, effectivePage, overflow } = resolvePageWindow(
    params.page,
    total,
  );

  if (overflow) {
    return { items: [], total, page: effectivePage, pageSize: PAGE_SIZE, pageCount };
  }

  const applications = await db.application.findMany({
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
    ? await db.evaluation.groupBy({
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

export async function getApplication(id: string): Promise<ApplicationDetail | null> {
  await requireUser();
  return db.application.findUnique({
    where: { id },
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
