import { tenantDb } from "../tenant-db";
import { csvRow } from "../csv";
import { logActivity } from "../activity";
import { assertAiBudget, chargeAiTokens } from "../ai-budget";
import { checkAiQuota } from "../rate-limit";
import { extractCandidateProfile, type CandidateProfile } from "../extraction/engine";
import { Prisma, type Candidate } from "../generated/prisma/client";
import type { CandidateSource, JobStatus, Stage } from "../validators/enums";
import type { CandidateCreateInput, CandidateUpdateInput } from "../validators/candidate";
import {
  CANDIDATE_OPTION_LIMIT,
  PAGE_SIZE,
  type CandidateListParams,
  type CandidateOptionParams,
} from "../validators/search";
import type { Paged } from "../types/paged";
import { assertCanWrite, type TenantContext } from "./context";
import { ConflictError, DomainError, NotFoundError } from "./errors";
import { isPrismaError } from "./prisma-errors";
import {
  COUNT_CAP,
  keysetPage,
  parseDateKey,
  parseStringKey,
  type CursorKey,
  type KeysetQuery,
  type KeysetSort,
  type SortDirection,
} from "./pagination";

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

/** `q` is matched literally: escape LIKE's wildcards (backslash is the default escape). */
function containsPattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * The candidate filter as SQL, because search reaches the resume through the
 * generated `resumeTsv` column, which Prisma can't query. Name, email and
 * headline ILIKEs are served by trigram indexes; the resume by its GIN index.
 * Scoped to the tenant here — the tenant client can't see inside raw SQL.
 */
function candidateFilterSql(companyId: string, params: CandidateListParams): Prisma.Sql {
  const conditions = [Prisma.sql`"companyId" = ${companyId}`];
  if (params.source) {
    conditions.push(Prisma.sql`"source" = ${params.source}::"CandidateSource"`);
  }
  const q = params.q.trim();
  if (q) {
    const pattern = containsPattern(q);
    conditions.push(Prisma.sql`(
      "name" ILIKE ${pattern}
      OR "email" ILIKE ${pattern}
      OR "headline" ILIKE ${pattern}
      OR "resumeTsv" @@ websearch_to_tsquery('english', ${q})
    )`);
  }
  return Prisma.join(conditions, " AND ");
}

interface CandidateKeyRow {
  id: string;
  name: string;
  createdAt: Date;
}

type CandidateSort = KeysetSort<Date | string, Prisma.Sql, Prisma.Sql, CandidateKeyRow>;

/** Row-value comparison seeks the (key, id) index directly; both columns sort the same way. */
function sqlSort(
  column: "createdAt" | "name",
  direction: SortDirection,
  parseKey: (raw: CursorKey) => Date | string | undefined,
): CandidateSort {
  const col = Prisma.raw(`"${column}"`);
  return {
    direction,
    parseKey,
    seekWhere: (key, id, scan) =>
      scan === "desc" ? Prisma.sql`(${col}, "id") < (${key}, ${id})` : Prisma.sql`(${col}, "id") > (${key}, ${id})`,
    orderBy: (scan) => {
      const dir = Prisma.raw(scan === "desc" ? "DESC" : "ASC");
      return Prisma.sql`${col} ${dir}, "id" ${dir}`;
    },
    keyOf: (row) => row[column],
  };
}

function candidateSort(sort: CandidateListParams["sort"]): CandidateSort {
  if (sort === "name") return sqlSort("name", "asc", parseStringKey);
  return sqlSort("createdAt", sort === "oldest" ? "asc" : "desc", parseDateKey);
}

function fetchCandidateKeys(
  ctx: TenantContext,
  filter: Prisma.Sql,
  query: KeysetQuery<Prisma.Sql, Prisma.Sql>,
): Promise<CandidateKeyRow[]> {
  const seek = query.where ? Prisma.sql`AND ${query.where}` : Prisma.empty;
  return tenantDb(ctx).$queryRaw<CandidateKeyRow[]>`
    SELECT "id", "name", "createdAt" FROM "Candidate"
    WHERE ${filter} ${seek}
    ORDER BY ${query.orderBy}
    LIMIT ${query.take}
  `;
}

async function countCandidates(ctx: TenantContext, filter: Prisma.Sql): Promise<number> {
  const rows = await tenantDb(ctx).$queryRaw<Array<{ count: number }>>`
    SELECT count(*)::int AS count
    FROM (SELECT 1 FROM "Candidate" WHERE ${filter} LIMIT ${COUNT_CAP + 1}) AS capped
  `;
  return rows[0]?.count ?? 0;
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

type CandidateListRow = Prisma.CandidateGetPayload<{ select: typeof listSelect }>;

/** Loads the full rows for a page of keys, in the keys' order. */
async function loadCandidateRows(
  ctx: TenantContext,
  keys: CandidateKeyRow[],
): Promise<CandidateListRow[]> {
  if (keys.length === 0) return [];
  const rows = await tenantDb(ctx).candidate.findMany({
    where: { companyId: ctx.companyId, id: { in: keys.map((k) => k.id) } },
    select: listSelect,
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  return keys.flatMap((k) => byId.get(k.id) ?? []);
}

export async function listCandidates(
  ctx: TenantContext,
  params: CandidateListParams,
): Promise<Paged<CandidateListItem>> {
  const filter = candidateFilterSql(ctx.companyId, params);
  const [counted, page] = await Promise.all([
    countCandidates(ctx, filter),
    keysetPage(candidateSort(params.sort), params, (query) => fetchCandidateKeys(ctx, filter, query)),
  ]);
  const candidates = await loadCandidateRows(ctx, page.items);

  const items: CandidateListItem[] = candidates.map((c) => ({
    id: c.id,
    name: c.name,
    email: c.email,
    headline: c.headline,
    source: c.source,
    createdAt: c.createdAt,
    applicationCount: c._count.applications,
  }));

  return {
    items,
    total: Math.min(counted, COUNT_CAP),
    totalCapped: counted > COUNT_CAP,
    pageSize: PAGE_SIZE,
    nextCursor: page.nextCursor,
    prevCursor: page.prevCursor,
  };
}

export async function getCandidate(
  ctx: TenantContext,
  id: string,
): Promise<CandidateDetail | null> {
  return tenantDb(ctx).candidate.findUnique({
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

/**
 * Typeahead for attaching candidates to a job: a bounded page of matches, so
 * the picker never ships the whole talent pool. Candidates already in the
 * job's pipeline (removed ones included — they come back by restore) are left out.
 */
export async function searchCandidateOptions(
  ctx: TenantContext,
  jobId: string,
  params: CandidateOptionParams,
): Promise<CandidateOption[]> {
  const q = params.q.trim();
  return tenantDb(ctx).candidate.findMany({
    where: {
      companyId: ctx.companyId,
      applications: { none: { jobId } },
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" as const } },
              { email: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    select: { id: true, name: true, email: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: CANDIDATE_OPTION_LIMIT,
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

  const filter = candidateFilterSql(ctx.companyId, params);
  const sort = candidateSort(params.sort);
  const [{ count: rowCount }] = await tenantDb(ctx).$queryRaw<[{ count: number }]>`
    SELECT count(*)::int AS count FROM "Candidate" WHERE ${filter}
  `;

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
  let last: CandidateKeyRow | null = null;
  let headerSent = false;

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!headerSent) {
        headerSent = true;
        controller.enqueue(encoder.encode(`${csvRow(CSV_HEADER)}\n`));
        return;
      }

      const keys = await fetchCandidateKeys(ctx, filter, {
        where: last
          ? sort.seekWhere(params.sort === "name" ? last.name : last.createdAt, last.id, sort.direction)
          : undefined,
        orderBy: sort.orderBy(sort.direction),
        take: CSV_EXPORT_BATCH,
      });
      const batch = await loadCandidateRows(ctx, keys);

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
      }
      last = keys.length > 0 ? keys[keys.length - 1] : last;
      if (keys.length < CSV_EXPORT_BATCH) {
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
    return await tenantDb(ctx).$transaction(async (tx) => {
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
    return await tenantDb(ctx).$transaction(async (tx) => {
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
    return await tenantDb(ctx).$transaction(async (tx) => {
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
  await assertAiBudget(ctx.companyId);
  const overQuota = await checkAiQuota({ userId: ctx.actorId, companyId: ctx.companyId });
  if (overQuota) throw new DomainError(overQuota);
  const { profile, tokens } = await extractCandidateProfile(resumeText);
  await chargeAiTokens(ctx.companyId, tokens);
  return profile;
}
