import { db } from "../db";
import { logActivity } from "../activity";
import type { Prisma } from "../generated/prisma/client";
import type { EmploymentType, JobStatus, RequirementWeight } from "../validators/enums";
import type { JobCreateInput, JobUpdateInput } from "../validators/job";
import { PAGE_SIZE, type JobListParams } from "../validators/search";
import type { Paged } from "../types/paged";
import { assertCanWrite, type TenantContext } from "./context";
import { NotFoundError } from "./errors";
import { isPrismaError } from "./prisma-errors";
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

const JOB_NOT_FOUND = "This job no longer exists.";

const withRequirements = {
  requirements: { orderBy: { order: "asc" } },
} satisfies Prisma.JobInclude;

function buildJobWhere(companyId: string, params: JobListParams): Prisma.JobWhereInput {
  const q = params.q.trim();
  return {
    companyId,
    status: params.status,
    title: q ? { contains: q, mode: "insensitive" } : undefined,
  };
}

function buildJobOrderBy(sort: JobListParams["sort"]): Prisma.JobOrderByWithRelationInput[] {
  if (sort === "oldest") return [{ createdAt: "asc" }, { id: "asc" }];
  if (sort === "title") return [{ title: "asc" }, { id: "asc" }];
  return [{ createdAt: "desc" }, { id: "asc" }];
}

export async function listJobs(
  ctx: TenantContext,
  params: JobListParams,
): Promise<Paged<JobListItem>> {
  const where = buildJobWhere(ctx.companyId, params);
  const total = await db.job.count({ where });
  const { pageCount, skip, take, effectivePage, overflow } = resolvePageWindow(params.page, total);

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
        where: {
          companyId: ctx.companyId,
          jobId: { in: jobIds },
          deletedAt: null,
          aiScore: { not: null },
        },
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

export async function getJob(ctx: TenantContext, id: string): Promise<JobDetail | null> {
  return db.job.findUnique({
    where: { id, companyId: ctx.companyId },
    include: withRequirements,
  });
}

export async function listJobOptions(ctx: TenantContext): Promise<JobOption[]> {
  return db.job.findMany({
    where: { status: "OPEN", companyId: ctx.companyId },
    select: { id: true, title: true, status: true },
    orderBy: [{ title: "asc" }, { id: "asc" }],
  });
}

export async function createJob(ctx: TenantContext, input: JobCreateInput): Promise<JobDetail> {
  assertCanWrite(ctx);
  const { requirements, ...jobFields } = input;

  return db.$transaction(async (tx) => {
    const job = await tx.job.create({
      data: {
        ...jobFields,
        companyId: ctx.companyId,
        createdById: ctx.actorId,
        requirements: {
          create: requirements.map((r, index) => ({
            label: r.label,
            weight: r.weight,
            order: index,
          })),
        },
      },
      include: withRequirements,
    });

    await logActivity(
      {
        companyId: ctx.companyId,
        actorId: ctx.actorId,
        action: "job.create",
        entityType: "job",
        entityId: job.id,
        summary: `created job "${job.title}"`,
      },
      tx,
    );

    return job;
  });
}

/**
 * Requirements are matched by id within this job only: an id from another
 * job (or tenant) is treated as a new requirement, never as a row to edit.
 */
export async function updateJob(ctx: TenantContext, input: JobUpdateInput): Promise<JobDetail> {
  assertCanWrite(ctx);
  const { id, requirements, ...jobFields } = input;

  return db.$transaction(async (tx) => {
    try {
      await tx.job.update({ where: { id, companyId: ctx.companyId }, data: jobFields });
    } catch (error) {
      if (isPrismaError(error, "P2025")) throw new NotFoundError(JOB_NOT_FOUND);
      throw error;
    }

    const existing = await tx.jobRequirement.findMany({
      where: { jobId: id },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((r) => r.id));
    const keepIds = new Set(requirements.flatMap((r) => (r.id ? [r.id] : [])));
    const toDelete = [...existingIds].filter((rid) => !keepIds.has(rid));

    if (toDelete.length) {
      await tx.jobRequirement.deleteMany({ where: { jobId: id, id: { in: toDelete } } });
    }

    for (const [index, requirement] of requirements.entries()) {
      const data = { label: requirement.label, weight: requirement.weight, order: index };
      if (requirement.id && existingIds.has(requirement.id)) {
        await tx.jobRequirement.update({ where: { id: requirement.id, jobId: id }, data });
      } else {
        await tx.jobRequirement.create({ data: { ...data, jobId: id } });
      }
    }

    const job = await tx.job.findUniqueOrThrow({
      where: { id, companyId: ctx.companyId },
      include: withRequirements,
    });

    await logActivity(
      {
        companyId: ctx.companyId,
        actorId: ctx.actorId,
        action: "job.update",
        entityType: "job",
        entityId: job.id,
        summary: `updated job "${job.title}"`,
      },
      tx,
    );

    return job;
  });
}

export async function setJobStatus(
  ctx: TenantContext,
  id: string,
  status: Extract<JobStatus, "OPEN" | "ARCHIVED">,
): Promise<JobDetail> {
  assertCanWrite(ctx);

  return db.$transaction(async (tx) => {
    let job: JobDetail;
    try {
      job = await tx.job.update({
        where: { id, companyId: ctx.companyId },
        data: { status },
        include: withRequirements,
      });
    } catch (error) {
      if (isPrismaError(error, "P2025")) throw new NotFoundError(JOB_NOT_FOUND);
      throw error;
    }

    const verb = status === "ARCHIVED" ? "archived" : "reopened";
    await logActivity(
      {
        companyId: ctx.companyId,
        actorId: ctx.actorId,
        action: status === "ARCHIVED" ? "job.archive" : "job.reopen",
        entityType: "job",
        entityId: job.id,
        summary: `${verb} job "${job.title}"`,
      },
      tx,
    );

    return job;
  });
}
