import { db } from "@resumerank/core/db";
import { requireUser } from "@/lib/auth/guards";
import { PAGE_SIZE, type JobListParams } from "@resumerank/core/validators/search";
import type {
  EmploymentType,
  JobStatus,
  RequirementWeight,
} from "@resumerank/core/validators/enums";
import type { Prisma } from "@resumerank/core/generated/prisma/client";
import type { Paged } from "@resumerank/core/types/paged";
import { resolvePageWindow } from "./pagination";

export interface JobListItem {
  id: string;
  title: string;
  location: string | null;
  employmentType: EmploymentType;
  status: JobStatus;
  createdAt: Date;
  requirementCount: number;
  applicationCount: number;
  averageScore: number | null;
}

export interface JobRequirementItem {
  id: string;
  label: string;
  weight: RequirementWeight;
  order: number;
}

export interface JobDetail {
  id: string;
  title: string;
  description: string;
  location: string | null;
  employmentType: EmploymentType;
  status: JobStatus;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
  requirements: JobRequirementItem[];
}

export interface JobOption {
  id: string;
  title: string;
  status: JobStatus;
}

function buildJobWhere(params: JobListParams): Prisma.JobWhereInput {
  const q = params.q.trim();
  return {
    status: params.status,
    title: q ? { contains: q, mode: "insensitive" } : undefined,
  };
}

function buildJobOrderBy(
  sort: JobListParams["sort"],
): Prisma.JobOrderByWithRelationInput[] {
  if (sort === "oldest") return [{ createdAt: "asc" }, { id: "asc" }];
  if (sort === "title") return [{ title: "asc" }, { id: "asc" }];
  return [{ createdAt: "desc" }, { id: "asc" }];
}

export async function listJobs(
  params: JobListParams,
): Promise<Paged<JobListItem>> {
  await requireUser();

  const where = buildJobWhere(params);
  const total = await db.job.count({ where });
  const { pageCount, skip, take, effectivePage, overflow } = resolvePageWindow(
    params.page,
    total,
  );

  if (overflow) {
    return { items: [], total, page: effectivePage, pageSize: PAGE_SIZE, pageCount };
  }

  const jobs = await db.job.findMany({
    where,
    orderBy: buildJobOrderBy(params.sort),
    skip,
    take,
    select: {
      id: true,
      title: true,
      location: true,
      employmentType: true,
      status: true,
      createdAt: true,
      _count: {
        select: {
          requirements: true,
          applications: { where: { deletedAt: null } },
        },
      },
    },
  });

  const jobIds = jobs.map((job) => job.id);
  const scoreGroups = jobIds.length
    ? await db.application.groupBy({
        by: ["jobId"],
        where: { jobId: { in: jobIds }, deletedAt: null, aiScore: { not: null } },
        _avg: { aiScore: true },
      })
    : [];
  const averageByJob = new Map(
    scoreGroups.map((g): [string, number | null] => [g.jobId, g._avg.aiScore]),
  );

  const items: JobListItem[] = jobs.map((job) => {
    const average = averageByJob.get(job.id);
    return {
      id: job.id,
      title: job.title,
      location: job.location,
      employmentType: job.employmentType,
      status: job.status,
      createdAt: job.createdAt,
      requirementCount: job._count.requirements,
      applicationCount: job._count.applications,
      averageScore: average == null ? null : Math.round(average),
    };
  });

  return { items, total, page: effectivePage, pageSize: PAGE_SIZE, pageCount };
}

export async function getJob(id: string): Promise<JobDetail | null> {
  await requireUser();
  return db.job.findUnique({
    where: { id },
    include: {
      requirements: { orderBy: { order: "asc" } },
    },
  });
}

export async function listJobOptions(): Promise<JobOption[]> {
  await requireUser();
  return db.job.findMany({
    where: { status: "OPEN" },
    select: { id: true, title: true, status: true },
    orderBy: [{ title: "asc" }, { id: "asc" }],
  });
}
