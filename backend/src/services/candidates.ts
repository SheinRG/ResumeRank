import { db } from "../db";
import { csvRow } from "../csv";
import { logActivity } from "../activity";
import { checkAiQuota } from "../rate-limit";
import { extractCandidateProfile, type CandidateProfile } from "../extraction/engine";
import type { Candidate, Prisma } from "../generated/prisma/client";
import type { CandidateSource, JobStatus, Stage } from "../validators/enums";
import type { CandidateCreateInput, CandidateUpdateInput } from "../validators/candidate";
import { PAGE_SIZE, type CandidateListParams } from "../validators/search";
import type { Paged } from "../types/paged";
import { assertCanWrite, type TenantContext } from "./context";
import { ConflictError, DomainError, NotFoundError } from "./errors";
import { isPrismaError } from "./prisma-errors";
import { resolvePageWindow } from "./pagination";

const CSV_EXPORT_BATCH = 500;
const CSV_HEADER = ["name", "email", "headline", "source", "applications", "createdAt"];
const CANDIDATE_NOT_FOUND = "This candidate no longer exists.";
function duplicateEmail(): ConflictError {
  return new ConflictError("Check the highlighted fields.", {
    email: ["A candidate with this email already exists."],
  });
}

export interface CandidateListItem {
  id: string;
  name: string;
  email: string;
  headline: string | null;
  source: CandidateSource;
  createdAt: Date;
  applicationCount: number;
}

export interface CandidateApplicationItem {
  id: string;
  stage: Stage;
  aiScore: number | null;
  createdAt: Date;
  job: { id: string; title: string; status: JobStatus };
}

export interface CandidateDetail {
  id: string;
  name: string;
  email: string;
  headline: string | null;
  source: CandidateSource;
  resumeText: string;
  createdAt: Date;
  updatedAt: Date;
  applications: CandidateApplicationItem[];
}

export interface CandidateOption {
  id: string;
  name: string;
  email: string;
}

export interface CandidateCsvExport {
  rowCount: number;
  stream: ReadableStream<Uint8Array>;
}

function buildCandidateWhere(
  companyId: string,
  params: CandidateListParams,
): Prisma.CandidateWhereInput {
  const q = params.q.trim();
  return {
    companyId,
    source: params.source,
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { email: { contains: q, mode: "insensitive" as const } },
            { headline: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
}

function buildCandidateOrderBy(
  sort: CandidateListParams["sort"],
): Prisma.CandidateOrderByWithRelationInput[] {
  if (sort === "oldest") return [{ createdAt: "asc" }, { id: "asc" }];
  if (sort === "name") return [{ name: "asc" }, { id: "asc" }];
  return [{ createdAt: "desc" }, { id: "asc" }];
}

const listSelect = {
  id: true,
  name: true,
  email: true,
  headline: true,
  source: true,
  createdAt: true,
  _count: { select: { applications: { where: { deletedAt: null } } } },
} satisfies Prisma.CandidateSelect;

export async function listCandidates(
  ctx: TenantContext,
  params: CandidateListParams,
): Promise<Paged<CandidateListItem>> {
  const where = buildCandidateWhere(ctx.companyId, params);
  const total = await db.candidate.count({ where });
  const { pageCount, skip, take, effectivePage, overflow } = resolvePageWindow(params.page, total);

  if (overflow) {
    return { items: [], total, page: effectivePage, pageSize: PAGE_SIZE, pageCount };
  }

  const candidates = await db.candidate.findMany({
    where,
    orderBy: buildCandidateOrderBy(params.sort),
    skip,
    take,
    select: listSelect,
  });

  const items: CandidateListItem[] = candidates.map((c) => ({
    id: c.id,
    name: c.name,
    email: c.email,
    headline: c.headline,
    source: c.source,
    createdAt: c.createdAt,
    applicationCount: c._count.applications,
  }));

  return { items, total, page: effectivePage, pageSize: PAGE_SIZE, pageCount };
}

export async function getCandidate(
  ctx: TenantContext,
  id: string,
): Promise<CandidateDetail | null> {
  return db.candidate.findUnique({
    where: { id, companyId: ctx.companyId },
    include: {
      applications: {
        where: { deletedAt: null },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        include: { job: { select: { id: true, title: true, status: true } } },
      },
    },
  });
}

export async function listCandidateOptions(ctx: TenantContext): Promise<CandidateOption[]> {
  return db.candidate.findMany({
    where: { companyId: ctx.companyId },
    select: { id: true, name: true, email: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
}

/**
 * Bulk PII export, so it requires write access rather than mere membership.
 * Rows stream in keyset-paged batches: no row cap, and memory stays at one
 * batch regardless of how many candidates the company has. The audit row is
 * written before the body streams so an abandoned download still leaves a
 * trail.
 */
export async function exportCandidatesCsv(
  ctx: TenantContext,
  params: CandidateListParams,
): Promise<CandidateCsvExport> {
  assertCanWrite(ctx);

  const where = buildCandidateWhere(ctx.companyId, params);
  const orderBy = buildCandidateOrderBy(params.sort);
  const rowCount = await db.candidate.count({ where });

  await logActivity({
    companyId: ctx.companyId,
    actorId: ctx.actorId,
    action: "candidate.export",
    entityType: "candidate",
    entityId: ctx.companyId,
    summary: `exported ${rowCount} candidate${rowCount === 1 ? "" : "s"} to CSV`,
    metadata: { rowCount, q: params.q || null, source: params.source ?? null },
  });

  const encoder = new TextEncoder();
  let cursor: string | null = null;
  let headerSent = false;

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!headerSent) {
        headerSent = true;
        controller.enqueue(encoder.encode(`${csvRow(CSV_HEADER)}\n`));
        return;
      }

      const batch = await db.candidate.findMany({
        where,
        orderBy,
        take: CSV_EXPORT_BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: listSelect,
      });

      if (batch.length > 0) {
        const lines = batch.map((c) =>
          csvRow([
            c.name,
            c.email,
            c.headline ?? "",
            c.source,
            String(c._count.applications),
            c.createdAt.toISOString(),
          ]),
        );
        controller.enqueue(encoder.encode(`${lines.join("\n")}\n`));
        cursor = batch[batch.length - 1].id;
      }
      if (batch.length < CSV_EXPORT_BATCH) {
        controller.close();
      }
    },
  });

  return { rowCount, stream };
}

export async function createCandidate(
  ctx: TenantContext,
  input: CandidateCreateInput,
): Promise<Candidate> {
  assertCanWrite(ctx);

  try {
    return await db.$transaction(async (tx) => {
      const candidate = await tx.candidate.create({
        data: { ...input, companyId: ctx.companyId, createdById: ctx.actorId },
      });
      await logActivity(
        {
          companyId: ctx.companyId,
          actorId: ctx.actorId,
          action: "candidate.create",
          entityType: "candidate",
          entityId: candidate.id,
          summary: `added candidate "${candidate.name}"`,
        },
        tx,
      );
      return candidate;
    });
  } catch (error) {
    if (isPrismaError(error, "P2002")) throw duplicateEmail();
    throw error;
  }
}

export async function updateCandidate(
  ctx: TenantContext,
  input: CandidateUpdateInput,
): Promise<Candidate> {
  assertCanWrite(ctx);
  const { id, ...fields } = input;

  try {
    return await db.$transaction(async (tx) => {
      const candidate = await tx.candidate.update({
        where: { id, companyId: ctx.companyId },
        data: fields,
      });
      await logActivity(
        {
          companyId: ctx.companyId,
          actorId: ctx.actorId,
          action: "candidate.update",
          entityType: "candidate",
          entityId: candidate.id,
          summary: `updated candidate "${candidate.name}"`,
        },
        tx,
      );
      return candidate;
    });
  } catch (error) {
    if (isPrismaError(error, "P2002")) throw duplicateEmail();
    if (isPrismaError(error, "P2025")) throw new NotFoundError(CANDIDATE_NOT_FOUND);
    throw error;
  }
}

export async function deleteCandidate(ctx: TenantContext, id: string): Promise<Candidate> {
  assertCanWrite(ctx);

  try {
    return await db.$transaction(async (tx) => {
      const candidate = await tx.candidate.delete({
        where: { id, companyId: ctx.companyId },
      });
      await logActivity(
        {
          companyId: ctx.companyId,
          actorId: ctx.actorId,
          action: "candidate.delete",
          entityType: "candidate",
          entityId: candidate.id,
          summary: `deleted candidate "${candidate.name}"`,
        },
        tx,
      );
      return candidate;
    });
  } catch (error) {
    if (isPrismaError(error, "P2025")) throw new NotFoundError(CANDIDATE_NOT_FOUND);
    throw error;
  }
}

/** Every AI call is a paid LLM request, so the tenant quota is enforced here rather than trusted to each adapter. */
export async function extractProfile(
  ctx: TenantContext,
  resumeText: string,
): Promise<CandidateProfile> {
  assertCanWrite(ctx);
  const overQuota = checkAiQuota({ userId: ctx.actorId, companyId: ctx.companyId });
  if (overQuota) throw new DomainError(overQuota);
  return extractCandidateProfile(resumeText);
}
