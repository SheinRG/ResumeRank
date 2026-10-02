import { db } from "@resumerank/core/db";
import { csvRow } from "@resumerank/core/csv";
import { requireMember, requireWriter } from "@/lib/auth/guards";
import { PAGE_SIZE, type CandidateListParams } from "@resumerank/core/validators/search";
import type { CandidateSource, JobStatus, Stage } from "@resumerank/core/validators/enums";
import type { Prisma } from "@resumerank/core/generated/prisma/client";
import type { Paged } from "@resumerank/core/types/paged";
import { resolvePageWindow } from "./pagination";

const CSV_EXPORT_BATCH = 500;
const CSV_HEADER = ["name", "email", "headline", "source", "applications", "createdAt"];

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

export async function listCandidates(
  params: CandidateListParams,
): Promise<Paged<CandidateListItem>> {
  const user = await requireMember();

  const where = buildCandidateWhere(user.companyId, params);
  const total = await db.candidate.count({ where });
  const { pageCount, skip, take, effectivePage, overflow } = resolvePageWindow(
    params.page,
    total,
  );

  if (overflow) {
    return { items: [], total, page: effectivePage, pageSize: PAGE_SIZE, pageCount };
  }

  const candidates = await db.candidate.findMany({
    where,
    orderBy: buildCandidateOrderBy(params.sort),
    skip,
    take,
    select: {
      id: true,
      name: true,
      email: true,
      headline: true,
      source: true,
      createdAt: true,
      _count: { select: { applications: { where: { deletedAt: null } } } },
    },
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

export async function getCandidate(id: string): Promise<CandidateDetail | null> {
  const user = await requireMember();
  return db.candidate.findUnique({
    where: { id, companyId: user.companyId },
    include: {
      applications: {
        where: { deletedAt: null },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        include: { job: { select: { id: true, title: true, status: true } } },
      },
    },
  });
}

export async function listCandidateOptions(): Promise<CandidateOption[]> {
  const user = await requireMember();
  return db.candidate.findMany({
    where: { companyId: user.companyId },
    select: { id: true, name: true, email: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
}

export interface CandidateCsvExport {
  rowCount: number;
  stream: ReadableStream<Uint8Array>;
}

/**
 * Bulk PII export, so it requires write access rather than mere membership.
 * Rows stream in keyset-paged batches: no row cap, and memory stays at one
 * batch regardless of how many candidates the company has.
 */
export async function exportCandidatesCsv(
  params: CandidateListParams,
): Promise<CandidateCsvExport> {
  const user = await requireWriter();

  const where = buildCandidateWhere(user.companyId, params);
  const orderBy = buildCandidateOrderBy(params.sort);
  const rowCount = await db.candidate.count({ where });
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
        select: {
          id: true,
          name: true,
          email: true,
          headline: true,
          source: true,
          createdAt: true,
          _count: { select: { applications: { where: { deletedAt: null } } } },
        },
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
