import { logActivity } from "../activity";
import { db } from "../db";
import type { ResumeFileKind } from "../generated/prisma/enums";
import { errorFields, log, withLogContext } from "../observability/log";
import { configuredBlobStore, type BlobStore } from "../storage/blob";
import { tenantDb, tenantTransaction } from "../tenant-db";
import { parseResumeFile, UnreadableResumeError, type ParsedResume, type ResumeParser } from "./parse";

export const MAX_PARSE_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 15_000;
/** Longer than OCR of the page cap; a RUNNING file older than this lost its worker. */
export const STALE_PARSE_MS = 3 * 60_000;
/** Claiming stops after this, so a file claimed last (OCR included) still ends inside the routes' 60s. */
export const DEFAULT_PARSE_BUDGET_MS = 15_000;
const DEFAULT_LANES = 2;

const UNAVAILABLE = "We couldn't read this file just now. Upload it again in a few minutes.";
const MISSING = "The uploaded file is missing from storage. Upload it again.";

interface ClaimedFile {
  id: string;
  companyId: string;
  candidateId: string;
  uploadedById: string | null;
  blobKey: string;
  fileName: string;
  kind: ResumeFileKind;
  attempts: number;
  lockedAt: Date;
  createdAt: Date;
}

/**
 * `SKIP LOCKED` lets any number of drains run at once without two of them
 * parsing the same file. The worker serves every tenant, so it claims with
 * the base client; each file's own writes go through its tenant's client.
 */
export async function claimNextResumeFile(now = new Date()): Promise<ClaimedFile | null> {
  const [claimed] = await db.$queryRaw<ClaimedFile[]>`
    UPDATE "ResumeFile"
    SET "status" = 'RUNNING', "lockedAt" = ${now}, "attempts" = "attempts" + 1, "updatedAt" = ${now}
    WHERE "id" = (
      SELECT "id" FROM "ResumeFile"
      WHERE "status" = 'QUEUED' AND "nextAttemptAt" <= ${now}
      ORDER BY "nextAttemptAt", "id"
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id", "companyId", "candidateId", "uploadedById", "blobKey", "fileName", "kind", "attempts", "lockedAt", "createdAt"
  `;
  return claimed ?? null;
}

/** A worker killed mid-parse (timeout, deploy) leaves its file RUNNING; it goes back to the queue, or fails when out of attempts. */
export async function recoverStaleResumeFiles(now = new Date()): Promise<number> {
  const staleBefore = new Date(now.getTime() - STALE_PARSE_MS);
  const [requeued, failed] = await db.$transaction([
    db.resumeFile.updateMany({
      where: { status: "RUNNING", lockedAt: { lt: staleBefore }, attempts: { lt: MAX_PARSE_ATTEMPTS } },
      data: { status: "QUEUED", lockedAt: null, nextAttemptAt: now },
    }),
    db.resumeFile.updateMany({
      where: { status: "RUNNING", lockedAt: { lt: staleBefore }, attempts: { gte: MAX_PARSE_ATTEMPTS } },
      data: { status: "FAILED", lockedAt: null, finishedAt: now, error: UNAVAILABLE },
    }),
  ]);
  const recovered = requeued.count + failed.count;
  if (recovered > 0) log.warn("resume_file.stale", { requeued: requeued.count, failed: failed.count });
  return recovered;
}

/** Only the claim that is still current may finish a file; a recovered-and-reclaimed one belongs to its new worker. */
function ownedBy(file: ClaimedFile) {
  return { id: file.id, companyId: file.companyId, status: "RUNNING" as const, lockedAt: file.lockedAt };
}

async function failFile(file: ClaimedFile, message: string): Promise<void> {
  await tenantDb(file).resumeFile.updateMany({
    where: ownedBy(file),
    data: { status: "FAILED", lockedAt: null, finishedAt: new Date(), error: message },
  });
  log.warn("resume_file.failed", { resumeFileId: file.id, attempts: file.attempts, reason: message });
}

async function retryOrFail(file: ClaimedFile, error: unknown): Promise<void> {
  log.error("resume_file.error", { resumeFileId: file.id, attempts: file.attempts, ...errorFields(error) });
  if (file.attempts >= MAX_PARSE_ATTEMPTS) {
    await failFile(file, UNAVAILABLE);
    return;
  }
  const delayMs = BASE_BACKOFF_MS * 2 ** (file.attempts - 1);
  await tenantDb(file).resumeFile.updateMany({
    where: ownedBy(file),
    data: { status: "QUEUED", lockedAt: null, nextAttemptAt: new Date(Date.now() + delayMs) },
  });
}

/**
 * Reads one claimed file and commits its outcome with the audit row. The text
 * replaces the candidate's resume text unless a newer upload has already
 * been read, so files finishing out of order can't bring back an old resume.
 */
export async function processResumeFile(
  file: ClaimedFile,
  store: BlobStore,
  parse: ResumeParser = parseResumeFile,
): Promise<void> {
  let bytes: Uint8Array | null;
  try {
    bytes = await store.get(file.blobKey);
  } catch (error) {
    await retryOrFail(file, error);
    return;
  }
  if (!bytes) {
    await failFile(file, MISSING);
    return;
  }

  let parsed: ParsedResume;
  try {
    parsed = await parse(file.kind, bytes);
  } catch (error) {
    if (error instanceof UnreadableResumeError) {
      await failFile(file, error.message);
      return;
    }
    await retryOrFail(file, error);
    return;
  }

  await tenantTransaction(file, async (tx) => {
    const { count } = await tx.resumeFile.updateMany({
      where: ownedBy(file),
      data: {
        status: "PARSED",
        lockedAt: null,
        finishedAt: new Date(),
        error: null,
        extraction: parsed.extraction,
        extractedChars: parsed.text.length,
      },
    });
    if (count === 0) {
      log.warn("resume_file.superseded", { resumeFileId: file.id });
      return;
    }
    const newerParsed = await tx.resumeFile.findFirst({
      where: {
        companyId: file.companyId,
        candidateId: file.candidateId,
        status: "PARSED",
        createdAt: { gt: file.createdAt },
      },
      select: { id: true },
    });
    const applied = !newerParsed;
    if (applied) {
      await tx.candidate.update({
        where: { id: file.candidateId, companyId: file.companyId },
        data: { resumeText: parsed.text },
      });
    }
    await logActivity(
      {
        companyId: file.companyId,
        actorId: file.uploadedById,
        action: "candidate.resume_parse",
        entityType: "candidate",
        entityId: file.candidateId,
        summary: applied
          ? `read the resume text from "${file.fileName}"`
          : `read "${file.fileName}", kept the newer upload's text`,
        metadata: {
          resumeFileId: file.id,
          extraction: parsed.extraction,
          extractedChars: parsed.text.length,
          applied,
        },
      },
      tx,
    );
  });
}

export interface ResumeDrainOptions {
  store?: BlobStore | null;
  parse?: ResumeParser;
  budgetMs?: number;
  lanes?: number;
}

/**
 * Works the queue until it is empty or the time budget is spent. Safe to
 * call from anywhere and as often as wanted (after an upload, from a status
 * poll, from a cron) because claiming is atomic.
 */
export async function drainResumeQueue(options: ResumeDrainOptions = {}): Promise<{ processed: number }> {
  const {
    store = configuredBlobStore(),
    parse,
    budgetMs = DEFAULT_PARSE_BUDGET_MS,
    lanes = DEFAULT_LANES,
  } = options;
  if (!store) return { processed: 0 };
  const deadline = Date.now() + budgetMs;

  return withLogContext({ worker: "resume-files" }, async () => {
    await recoverStaleResumeFiles();
    let processed = 0;

    const lane = async (): Promise<void> => {
      while (Date.now() < deadline) {
        const file = await claimNextResumeFile();
        if (!file) return;
        await withLogContext({ resumeFileId: file.id, companyId: file.companyId }, async () => {
          try {
            await processResumeFile(file, store, parse);
          } catch (error) {
            await retryOrFail(file, error);
          }
        });
        processed += 1;
      }
    };

    await Promise.all(Array.from({ length: lanes }, lane));
    if (processed > 0) log.info("resume_file.drained", { processed });
    return { processed };
  });
}
