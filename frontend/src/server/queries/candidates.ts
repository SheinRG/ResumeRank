import { db } from "@resumerank/core/db";
import { requireUser } from "@/lib/auth/guards";
import { PAGE_SIZE, type CandidateListParams } from "@resumerank/core/validators/search";
import type { CandidateSource, JobStatus, Stage } from "@resumerank/core/validators/enums";
import type { Prisma } from "@resumerank/core/generated/prisma/client";
import type { Paged } from "@resumerank/core/types/paged";
import { resolvePageWindow } from "./pagination";

const CSV_EXPORT_CAP = 1000;

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
  params: CandidateListParams,
): Prisma.CandidateWhereInput {
  const q = params.q.trim();
  return {
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
  await requireUser();

  const where = buildCandidateWhere(params);
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
  await requireUser();
  return db.candidate.findUnique({
    where: { id },
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
  await requireUser();
  return db.candidate.findMany({
    select: { id: true, name: true, email: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
}

function csvField(value: string): string {
  return /["\n,]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export async function exportCandidatesCsv(
  params: CandidateListParams,
): Promise<string> {
  await requireUser();

  const where = buildCandidateWhere(params);
  const candidates = await db.candidate.findMany({
    where,
    orderBy: buildCandidateOrderBy(params.sort),
    take: CSV_EXPORT_CAP,
    select: {
      name: true,
      email: true,
      headline: true,
      source: true,
      createdAt: true,
      _count: { select: { applications: { where: { deletedAt: null } } } },
    },
  });

  const header = "name,email,headline,source,applications,createdAt";
  const rows = candidates.map((c) =>
    [
      c.name,
      c.email,
      c.headline ?? "",
      c.source,
      String(c._count.applications),
      c.createdAt.toISOString(),
    ]
      .map(csvField)
      .join(","),
  );

  return [header, ...rows].join("\n");
}
