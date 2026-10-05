import { tenantDb } from "../tenant-db";
import { logActivity } from "../activity";
import { Prisma } from "../generated/prisma/client";
import type { EmploymentType, JobStatus, RequirementWeight } from "../validators/enums";
import type { JobCreateInput, JobUpdateInput } from "../validators/job";
import { PAGE_SIZE, type JobListParams } from "../validators/search";
import type { Paged } from "../types/paged";
import { assertCanWrite, type TenantContext } from "./context";
import { NotFoundError } from "./errors";
import { isPrismaError } from "./prisma-errors";
import {
  countCapped,
  createdAtSort,
  keysetPage,
  parseStringKey,
  past,
  through,
  type KeysetQuery,
  type KeysetSort,
} from "./pagination";

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

const jobListSelect = {
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
} satisfies Prisma.JobSelect;

type JobListRow = Prisma.JobGetPayload<{ select: typeof jobListSelect }>;
const titleSort: KeysetSort<string, Prisma.JobWhereInput, Prisma.JobOrderByWithRelationInput[], JobListRow> = {
  direction: "asc",
  parseKey: parseStringKey,
  seekWhere: (key, id, scan) => ({
    title: through(scan, key),
    OR: [{ title: past(scan, key) }, { title: key, id: past(scan, id) }],
  }),
  orderBy: (scan) => [{ title: scan }, { id: scan }],
  keyOf: (row) => row.title,
};

function listJobsPage(
  ctx: TenantContext,
  params: JobListParams,
  where: Prisma.JobWhereInput,
) {
  const fetch = (query: KeysetQuery<Prisma.JobWhereInput, Prisma.JobOrderByWithRelationInput[]>) =>
    tenantDb(ctx).job.findMany({
      where: query.where ? { AND: [where, query.where] } : where,
      orderBy: query.orderBy,
      take: query.take,
      select: jobListSelect,
    });
  if (params.sort === "title") return keysetPage(titleSort, params, fetch);
  return keysetPage(createdAtSort<JobListRow>(params.sort === "oldest" ? "asc" : "desc"), params, fetch);
}

export async function listJobs(
  ctx: TenantContext,
  params: JobListParams,
): Promise<Paged<JobListItem>> {
  const where = buildJobWhere(ctx.companyId, params);
  const [{ total, totalCapped }, page] = await Promise.all([
    countCapped((take) => tenantDb(ctx).job.count({ where, take })),
    listJobsPage(ctx, params, where),
  ]);
  const jobs = page.items;

  const jobIds = jobs.map((job) => job.id);
  const scoreGroups = jobIds.length
    ? await tenantDb(ctx).application.groupBy({
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

  return {
    items,
    total,
    totalCapped,
    pageSize: PAGE_SIZE,
    nextCursor: page.nextCursor,
    prevCursor: page.prevCursor,
  };
}

export async function getJob(ctx: TenantContext, id: string): Promise<JobDetail | null> {
  return tenantDb(ctx).job.findUnique({
    where: { id, companyId: ctx.companyId },
    include: withRequirements,
  });
}

export async function listJobOptions(ctx: TenantContext): Promise<JobOption[]> {
  return tenantDb(ctx).job.findMany({
    where: { status: "OPEN", companyId: ctx.companyId },
    select: { id: true, title: true, status: true },
    orderBy: [{ title: "asc" }, { id: "asc" }],
  });
}

export async function createJob(ctx: TenantContext, input: JobCreateInput): Promise<JobDetail> {
  assertCanWrite(ctx);
  const { requirements, ...jobFields } = input;

  return tenantDb(ctx).$transaction(async (tx) => {
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

  return tenantDb(ctx).$transaction(async (tx) => {
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

    const ordered = requirements.map((r, index) => ({ ...r, order: index }));
    const updates = ordered.flatMap((r) => (r.id && existingIds.has(r.id) ? [{ ...r, id: r.id }] : []));
    const creates = ordered.filter((r) => !(r.id && existingIds.has(r.id)));

    // One statement for every edited row instead of a round trip each; the
    // jobId match keeps it inside the job checked above.
    if (updates.length) {
      const rows = updates.map((r) => Prisma.sql`(${r.id}, ${r.label}, ${r.weight}, ${r.order})`);
      await tx.$executeRaw`
        UPDATE "JobRequirement" AS r
        SET "label" = v.label,
            "weight" = v.weight::"RequirementWeight",
            "order" = v.ord::int
        FROM (VALUES ${Prisma.join(rows)}) AS v(id, label, weight, ord)
        WHERE r."id" = v.id AND r."jobId" = ${id}
      `;
    }
    if (creates.length) {
      await tx.jobRequirement.createMany({
        data: creates.map((r) => ({ jobId: id, label: r.label, weight: r.weight, order: r.order })),
      });
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

  return tenantDb(ctx).$transaction(async (tx) => {
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
