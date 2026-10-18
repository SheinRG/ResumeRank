import { db } from "../db";
import { logActivity } from "../activity";
import { errorFields, log } from "../observability/log";
import { configuredBlobStore, type BlobStore } from "../storage/blob";
import { tenantTransaction } from "../tenant-db";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Bounds one company's work per run; a backlog clears over several. */
const MAX_PURGE_PER_RUN = 200;

/**
 * Deletes one company's candidates who have had no activity for longer than
 * its retention period: neither the candidate nor any of their applications
 * changed since the cutoff. Everything about them goes with them (the rows
 * cascade, scoring records included), and their uploaded files after commit.
 * The audit entry records how many, never who.
 */
async function purgeCompany(companyId: string, retentionDays: number, now: Date, store: BlobStore | null): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);

  const { deleted, blobKeys } = await tenantTransaction({ companyId }, async (tx) => {
    const expired = await tx.candidate.findMany({
      where: { companyId, updatedAt: { lt: cutoff }, applications: { none: { updatedAt: { gte: cutoff } } } },
      orderBy: { updatedAt: "asc" },
      take: MAX_PURGE_PER_RUN,
      select: { id: true },
    });
    if (expired.length === 0) return { deleted: 0, blobKeys: [] };
    const ids = expired.map((candidate) => candidate.id);

    const files = await tx.resumeFile.findMany({
      where: { companyId, candidateId: { in: ids } },
      select: { blobKey: true },
    });
    const { count } = await tx.candidate.deleteMany({ where: { companyId, id: { in: ids } } });
    await logActivity(
      {
        companyId,
        actorId: null,
        action: "candidate.retention_purge",
        entityType: "company",
        entityId: companyId,
        summary: `deleted ${count} candidate${count === 1 ? "" : "s"} with no activity for ${retentionDays} days`,
        metadata: { deleted: count, retentionDays },
      },
      tx,
    );
    return { deleted: count, blobKeys: files.map((file) => file.blobKey) };
  });

  if (blobKeys.length > 0) {
    try {
      if (!store) throw new Error("Blob storage is not configured");
      await store.delete(blobKeys);
    } catch (error) {
      log.error("retention.blob_delete_failed", { companyId, blobKeys, ...errorFields(error) });
    }
  }
  return deleted;
}

/** Applies every company's candidate retention policy. Safe to run from overlapping crons. */
export async function purgeExpiredCandidates(
  now = new Date(),
  store: BlobStore | null = configuredBlobStore(),
): Promise<{ deleted: number }> {
  const companies = await db.company.findMany({
    where: { candidateRetentionDays: { not: null } },
    select: { id: true, candidateRetentionDays: true },
  });

  let deleted = 0;
  for (const company of companies) {
    if (company.candidateRetentionDays === null) continue;
    try {
      deleted += await purgeCompany(company.id, company.candidateRetentionDays, now, store);
    } catch (error) {
      log.error("retention.purge_failed", { companyId: company.id, ...errorFields(error) });
    }
  }
  if (deleted > 0) log.info("retention.purged", { deleted });
  return { deleted };
}
