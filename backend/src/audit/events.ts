import { csvRow } from "../csv";
import type { Prisma } from "../generated/prisma/client";

/**
 * One audit entry as it leaves the system, in an export or a SIEM stream.
 * Flat, so the CSV columns and the JSON keys are the same set, and stable:
 * SIEM parsers and saved searches are written against these names.
 */
export interface AuditEvent {
  id: string;
  seq: number;
  timestamp: string;
  companyId: string;
  action: string;
  entityType: string;
  entityId: string;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  summary: string;
  metadata: Prisma.JsonValue | null;
  prevHash: string | null;
  hash: string;
}

export const AUDIT_EVENT_SELECT = {
  id: true,
  seq: true,
  createdAt: true,
  companyId: true,
  action: true,
  entityType: true,
  entityId: true,
  actorId: true,
  summary: true,
  metadata: true,
  prevHash: true,
  hash: true,
  actor: { select: { name: true, email: true } },
} as const satisfies Prisma.ActivityLogSelect;

export type AuditEventRow = Prisma.ActivityLogGetPayload<{ select: typeof AUDIT_EVENT_SELECT }>;

/** Null for an entry its transaction hasn't sealed yet; committed entries are always sealed. */
export function toAuditEvent(row: AuditEventRow): AuditEvent | null {
  if (row.seq === null || row.hash === null) return null;
  return {
    id: row.id,
    seq: Number(row.seq),
    timestamp: row.createdAt.toISOString(),
    companyId: row.companyId,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    actorId: row.actorId,
    actorName: row.actor?.name ?? null,
    actorEmail: row.actor?.email ?? null,
    summary: row.summary,
    metadata: row.metadata,
    prevHash: row.prevHash,
    hash: row.hash,
  };
}

export function toAuditEvents(rows: readonly AuditEventRow[]): AuditEvent[] {
  return rows.flatMap((row) => {
    const event = toAuditEvent(row);
    return event ? [event] : [];
  });
}

export const AUDIT_CSV_HEADER = [
  "seq",
  "timestamp",
  "action",
  "entity_type",
  "entity_id",
  "actor_id",
  "actor_name",
  "actor_email",
  "summary",
  "metadata",
  "prev_hash",
  "hash",
] as const;

export function auditCsvRow(event: AuditEvent): string {
  return csvRow([
    String(event.seq),
    event.timestamp,
    event.action,
    event.entityType,
    event.entityId,
    event.actorId ?? "",
    event.actorName ?? "",
    event.actorEmail ?? "",
    event.summary,
    event.metadata === null ? "" : JSON.stringify(event.metadata),
    event.prevHash ?? "",
    event.hash,
  ]);
}

export function auditJsonLine(event: AuditEvent): string {
  return JSON.stringify(event);
}
