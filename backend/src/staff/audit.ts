import { db } from "../db";
import type { Prisma } from "../generated/prisma/client";
import { decodeCursor, encodeCursor, parseDateKey } from "../services/pagination";
import type { StaffAuditPageInput } from "../validators/staff";
import { assertStaffRole, type StaffActor } from "./actor";

const PAGE_SIZE = 50;

export interface StaffAuditItem {
  id: string;
  staffEmail: string;
  action: string;
  summary: string;
  companyId: string | null;
  companyName: string | null;
  metadata: Prisma.JsonValue | null;
  ipAddress: string | null;
  createdAt: Date;
}

export interface StaffAuditPage {
  items: StaffAuditItem[];
  nextCursor: string | null;
}

/** Newest first, every staff member's entries; any staff member may read it, so each sees what the others did. */
export async function listStaffAudit(actor: StaffActor, input: StaffAuditPageInput): Promise<StaffAuditPage> {
  assertStaffRole(actor, "SUPPORT");
  const seek = input.cursor ? decodeCursor(input.cursor) : null;
  const after = seek ? parseDateKey(seek.key) : undefined;
  const where: Prisma.StaffAuditEntryWhereInput = {
    ...(input.companyId ? { companyId: input.companyId } : {}),
    ...(seek && after
      ? { createdAt: { lte: after }, OR: [{ createdAt: { lt: after } }, { createdAt: after, id: { lt: seek.id } }] }
      : {}),
  };
  const rows = await db.staffAuditEntry.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
  });
  const page = rows.slice(0, PAGE_SIZE);
  const companyIds = [...new Set(page.flatMap((row) => (row.companyId ? [row.companyId] : [])))];
  const companies = new Map(
    (await db.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } })).map(
      (company) => [company.id, company.name],
    ),
  );
  const last = page.at(-1);
  return {
    items: page.map((row) => ({
      id: row.id,
      staffEmail: row.staffEmail,
      action: row.action,
      summary: row.summary,
      companyId: row.companyId,
      companyName: row.companyId ? (companies.get(row.companyId) ?? null) : null,
      metadata: row.metadata,
      ipAddress: row.ipAddress,
      createdAt: row.createdAt,
    })),
    nextCursor: rows.length > PAGE_SIZE && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}
