import { db } from "../db";
import { logActivity } from "../activity";
import { log } from "../observability/log";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Bounds one company's work per drain; a long backlog clears over several. */
const MAX_PURGE_PER_RUN = 50_000;

interface PurgeBoundary {
  throughSeq: bigint | null;
  throughHash: string | null;
}

/**
 * Deletes one company's entries older than its retention period, oldest
 * first and always a whole prefix of the chain. The newest entry is never
 * deleted, so the chain (and every stream cursor) keeps counting from it.
 * The purge records where it cut the chain, which is what lets a later
 * verification tell this from tampering.
 */
async function purgeCompany(companyId: string, retentionDays: number, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);

  return db.$transaction(async (tx) => {
    // Seq follows commit order and createdAt start order, so the cut is
    // made by seq: the newest expired entry, and everything before it.
    const [boundary] = await tx.$queryRaw<PurgeBoundary[]>`
      WITH bounds AS (
        SELECT
          (SELECT max("seq") FROM "ActivityLog" WHERE "companyId" = ${companyId} AND "createdAt" < ${cutoff}) AS expired,
          (SELECT max("seq") - 1 FROM "ActivityLog" WHERE "companyId" = ${companyId}) AS below_tip,
          (SELECT min("seq") + ${MAX_PURGE_PER_RUN - 1} FROM "ActivityLog" WHERE "companyId" = ${companyId}) AS batch_end
      )
      SELECT entry."seq" AS "throughSeq", entry."hash" AS "throughHash"
      FROM bounds
      JOIN "ActivityLog" entry
        ON entry."companyId" = ${companyId} AND entry."seq" = LEAST(bounds.expired, bounds.below_tip, bounds.batch_end)
      -- LEAST skips NULLs: without this, nothing expired would mean "all but the newest".
      WHERE bounds.expired IS NOT NULL
    `;
    if (!boundary?.throughSeq || !boundary.throughHash) return 0;

    await tx.$executeRaw`SELECT set_config('app.audit_purge', 'on', true)`;
    const deleted = await tx.$executeRaw`
      DELETE FROM "ActivityLog" WHERE "companyId" = ${companyId} AND "seq" <= ${boundary.throughSeq}
    `;
    await tx.$executeRaw`SELECT set_config('app.audit_purge', '', true)`;
    // An overlapping run got there first; it recorded the cut.
    if (deleted === 0) return 0;

    await logActivity(
      {
        companyId,
        actorId: null,
        action: "audit.purge",
        entityType: "company",
        entityId: companyId,
        summary: `deleted ${deleted} audit ${deleted === 1 ? "entry" : "entries"} older than ${retentionDays} days`,
        metadata: {
          deleted,
          retentionDays,
          throughSeq: Number(boundary.throughSeq),
          throughHash: boundary.throughHash,
        },
      },
      tx,
    );
    return deleted;
  });
}

/** Applies every company's retention policy. Safe to run from overlapping crons: deletes are idempotent. */
export async function purgeExpiredAuditEntries(now = new Date()): Promise<{ deleted: number }> {
  const companies = await db.company.findMany({
    where: { auditRetentionDays: { not: null } },
    select: { id: true, auditRetentionDays: true },
  });

  let deleted = 0;
  for (const company of companies) {
    if (company.auditRetentionDays === null) continue;
    const count = await purgeCompany(company.id, company.auditRetentionDays, now);
    if (count > 0) log.info("audit.purged", { companyId: company.id, deleted: count });
    deleted += count;
  }
  return { deleted };
}
