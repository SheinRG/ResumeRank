import { createHash, randomUUID } from "node:crypto";

import { logActivity } from "../activity";
import { CANDIDATE_REF } from "../audit/candidate-ref";
import type { ResumeFile } from "../generated/prisma/client";
import type { ResumeExtraction, ResumeFileKind, ResumeFileStatus } from "../generated/prisma/enums";
import { sniffResumeKind } from "../ingestion/sniff";
import { errorFields, log } from "../observability/log";
import { rateLimit, RESUME_UPLOAD_LIMIT, retryMessage } from "../rate-limit";
import { configuredBlobStore, type BlobStore } from "../storage/blob";
import { tenantDb, tenantTransaction } from "../tenant-db";
import { RESUME_FILE_MAX_BYTES, RESUME_FILE_TYPES } from "../validators/resume-file";
import { candidateAccessWhere } from "./access";
import { assertCan, type TenantContext } from "./context";
import { DomainError, NotFoundError } from "./errors";
import { assertFeature } from "./features";

const CANDIDATE_NOT_FOUND = "This candidate no longer exists.";
const FILE_NOT_FOUND = "This file no longer exists.";
const UPLOADS_OFF = "Resume file uploads aren't set up on this server. Paste the resume text instead.";
const MAX_FILE_NAME = 120;

export interface ResumeFileItem {
  id: string;
  fileName: string;
  kind: ResumeFileKind;
  sizeBytes: number;
  status: ResumeFileStatus;
  extraction: ResumeExtraction | null;
  extractedChars: number | null;
  error: string | null;
  createdAt: Date;
  uploadedBy: { name: string | null } | null;
}

export interface ResumeFileDownload {
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
}

export interface UploadResumeFileInput {
  candidateId: string;
  /** The uploader's name for the file: shown and offered on download, never used in a storage key. */
  fileName: string;
  bytes: Uint8Array;
}

const ITEM_SELECT = {
  id: true,
  fileName: true,
  kind: true,
  sizeBytes: true,
  status: true,
  extraction: true,
  extractedChars: true,
  error: true,
  createdAt: true,
  uploadedBy: { select: { name: true } },
} as const;

/** The base name only, without control characters, so it's safe to show and to offer as a download name. */
export function cleanFileName(raw: string, kind: ResumeFileKind): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[\u0000-\u001F\u007F"]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_FILE_NAME);
  return cleaned || `resume.${RESUME_FILE_TYPES[kind].extension}`;
}

/**
 * Keeps the original in blob storage and queues it to be read; the queue
 * worker (`ingestion/queue.ts`) turns it into the candidate's resume text.
 * The type comes from the file's bytes, and the storage key from the
 * company and a server-made id, never from anything the uploader sent.
 */
export async function uploadResumeFile(
  ctx: TenantContext,
  input: UploadResumeFileInput,
  store: BlobStore | null = configuredBlobStore(),
): Promise<ResumeFile> {
  assertCan(ctx, "candidate.manage");
  await assertFeature(ctx, "resume-files");
  if (!store) throw new DomainError(UPLOADS_OFF);

  const { bytes } = input;
  if (bytes.length === 0) throw new DomainError("That file is empty.");
  if (bytes.length > RESUME_FILE_MAX_BYTES) throw new DomainError("Files can be at most 4 MB.");
  const kind = sniffResumeKind(bytes);
  if (!kind) throw new DomainError("Upload a PDF or Word (.docx) file.");

  const candidate = await tenantDb(ctx).candidate.findFirst({
    where: { id: input.candidateId, companyId: ctx.companyId, ...candidateAccessWhere(ctx) },
    select: { id: true, name: true },
  });
  if (!candidate) throw new NotFoundError(CANDIDATE_NOT_FOUND);

  const limited = await rateLimit(`resume-upload:${ctx.actorId}`, RESUME_UPLOAD_LIMIT);
  if (!limited.allowed) {
    throw new DomainError(`Too many uploads. Try again in ${retryMessage(limited.retryAfterSeconds)}.`);
  }

  const id = randomUUID();
  const { mime, extension } = RESUME_FILE_TYPES[kind];
  const blobKey = `${ctx.companyId}/resumes/${id}.${extension}`;
  const fileName = cleanFileName(input.fileName, kind);
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  await store.put(blobKey, bytes, mime);
  try {
    return await tenantTransaction(ctx, async (tx) => {
      const file = await tx.resumeFile.create({
        data: {
          id,
          companyId: ctx.companyId,
          candidateId: candidate.id,
          uploadedById: ctx.actorId,
          blobKey,
          fileName,
          kind,
          sizeBytes: bytes.length,
          sha256,
        },
      });
      await logActivity(
        {
          companyId: ctx.companyId,
          actorId: ctx.actorId,
          action: "candidate.resume_upload",
          entityType: "candidate",
          entityId: candidate.id,
          // The file name is left out too: it's often the candidate's name.
          summary: `uploaded a ${kind} resume file for ${CANDIDATE_REF}`,
          metadata: { resumeFileId: id, kind, sizeBytes: bytes.length, sha256 },
        },
        tx,
      );
      return file;
    });
  } catch (error) {
    // Nothing points at the stored file, so take it back out.
    await store.delete([blobKey]).catch((cleanup: unknown) => {
      log.warn("resume_file.orphaned_blob", { blobKey, ...errorFields(cleanup) });
    });
    throw error;
  }
}

/** Everyone who can see the candidate sees their files: these are the resume, not AI output. */
export async function listResumeFiles(ctx: TenantContext, candidateId: string): Promise<ResumeFileItem[]> {
  return tenantDb(ctx).resumeFile.findMany({
    where: { companyId: ctx.companyId, candidateId, candidate: candidateAccessWhere(ctx) },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    select: ITEM_SELECT,
  });
}

/** The stored original, exactly as uploaded. Each download is recorded, as it hands out personal data. */
export async function getResumeFileDownload(
  ctx: TenantContext,
  id: string,
  store: BlobStore | null = configuredBlobStore(),
): Promise<ResumeFileDownload> {
  const file = await tenantDb(ctx).resumeFile.findFirst({
    where: { id, companyId: ctx.companyId, candidate: candidateAccessWhere(ctx) },
    select: { id: true, candidateId: true, blobKey: true, fileName: true, kind: true },
  });
  if (!file) throw new NotFoundError(FILE_NOT_FOUND);
  if (!store) throw new DomainError(UPLOADS_OFF);

  const bytes = await store.get(file.blobKey);
  if (!bytes) throw new NotFoundError(FILE_NOT_FOUND);

  await logActivity({
    companyId: ctx.companyId,
    actorId: ctx.actorId,
    action: "candidate.resume_download",
    entityType: "candidate",
    entityId: file.candidateId,
    summary: `downloaded a resume file of ${CANDIDATE_REF}`,
    metadata: { resumeFileId: file.id },
  });
  return { fileName: file.fileName, contentType: RESUME_FILE_TYPES[file.kind].mime, bytes };
}
