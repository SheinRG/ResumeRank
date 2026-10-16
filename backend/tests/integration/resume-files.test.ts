import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "../../src/db";
import { UnreadableResumeError, type ResumeParser } from "../../src/ingestion/parse";
import { drainResumeQueue } from "../../src/ingestion/queue";
import { createCandidate, deleteCandidate } from "../../src/services/candidates";
import type { TenantContext } from "../../src/services/context";
import { DomainError, FeatureUnavailableError, ForbiddenError, NotFoundError } from "../../src/services/errors";
import { assignToJob } from "../../src/services/hiring-team";
import { getResumeFileDownload, listResumeFiles, uploadResumeFile } from "../../src/services/resume-files";
import type { BlobStore } from "../../src/storage/blob";
import { candidateCreateSchema } from "../../src/validators/candidate";
import { memoryBlobStore } from "../memory-blob-store";
import { docx, RESUME_LINES, textPdf } from "../resume-files";
import { createTenant, destroyTenant, RESUME_TEXT, type TenantFixture } from "./fixtures";

let t: TenantFixture;
let interviewer: TenantContext;
/** A candidate on no job: restricted roles can't reach them. */
let poolCandidateId: string;
let store: ReturnType<typeof memoryBlobStore>;

const pdf = textPdf(RESUME_LINES);
const quickParse: ResumeParser = async (_kind, bytes) => ({
  text: `Parsed resume ${bytes.length} bytes. ${RESUME_TEXT}`,
  extraction: "TEXT",
});

async function addInterviewer(): Promise<TenantContext> {
  const tag = randomUUID().slice(0, 8);
  const user = await db.user.create({
    data: { name: `Interviewer ${tag}`, email: `interviewer-${tag}@example.test`, role: "INTERVIEWER", companyId: t.companyId },
  });
  t.userIds.push(user.id);
  return { companyId: t.companyId, actorId: user.id, role: "INTERVIEWER" };
}

function upload(bytes: Uint8Array, fileName = "resume.pdf", candidateId = t.candidateId, ctx = t.owner) {
  return uploadResumeFile(ctx, { candidateId, fileName, bytes }, store);
}

async function resumeText(candidateId = t.candidateId): Promise<string | undefined> {
  return (await db.candidate.findUnique({ where: { id: candidateId } }))?.resumeText;
}

beforeAll(async () => {
  t = await createTenant("resume-files");
  interviewer = await addInterviewer();
  await assignToJob(t.owner, { jobId: t.jobId, userId: interviewer.actorId });
  const pool = await createCandidate(
    t.owner,
    candidateCreateSchema.parse({
      name: "Pool Candidate",
      email: `pool-${randomUUID().slice(0, 8)}@example.test`,
      source: "MANUAL",
      resumeText: RESUME_TEXT,
    }),
  );
  poolCandidateId = pool.id;
});

beforeEach(async () => {
  store = memoryBlobStore();
  await db.resumeFile.deleteMany({ where: { companyId: t.companyId } });
});

afterAll(async () => {
  if (t) await destroyTenant(t);
  await db.$disconnect();
});

describe("uploadResumeFile", () => {
  it("keeps the original under a key made from the company and a server id, whatever the file is called", async () => {
    const file = await upload(pdf, "../../other-company/resumes/evil.exe");

    expect(file).toMatchObject({ kind: "PDF", status: "QUEUED", sizeBytes: pdf.length, fileName: "evil.exe" });
    expect(file.blobKey).toBe(`${t.companyId}/resumes/${file.id}.pdf`);
    expect(store.blobs.get(file.blobKey)).toEqual(pdf);
    const activity = await db.activityLog.findFirst({
      where: { companyId: t.companyId, action: "candidate.resume_upload", entityId: t.candidateId },
      orderBy: { createdAt: "desc" },
    });
    expect(activity?.metadata).toMatchObject({ resumeFileId: file.id, sha256: file.sha256 });
  });

  it("decides the type from the bytes, not the name or the browser's claim", async () => {
    const word = await upload(docx(RESUME_LINES), "resume.pdf");
    expect(word.kind).toBe("DOCX");
    expect(word.blobKey.endsWith(".docx")).toBe(true);

    await expect(upload(new TextEncoder().encode("<script>alert(1)</script>"), "resume.pdf")).rejects.toThrow(
      "Upload a PDF or Word (.docx) file.",
    );
    expect(store.blobs.size).toBe(1);
  });

  it("is refused to roles that can't edit candidates, and for candidates out of reach", async () => {
    await expect(upload(pdf, "r.pdf", t.candidateId, t.viewer)).rejects.toThrow(ForbiddenError);
    await expect(upload(pdf, "r.pdf", t.candidateId, interviewer)).rejects.toThrow(ForbiddenError);
    await expect(upload(pdf, "r.pdf", "missing-candidate")).rejects.toThrow(NotFoundError);
    expect(store.blobs.size).toBe(0);
  });

  it("is off without a configured store, and when the workspace isn't entitled", async () => {
    await expect(
      uploadResumeFile(t.owner, { candidateId: t.candidateId, fileName: "r.pdf", bytes: pdf }, null),
    ).rejects.toThrow(DomainError);

    await db.featureFlagOverride.create({ data: { companyId: t.companyId, flag: "resume-files", enabled: false } });
    try {
      await expect(upload(pdf)).rejects.toThrow(FeatureUnavailableError);
    } finally {
      await db.featureFlagOverride.deleteMany({ where: { companyId: t.companyId, flag: "resume-files" } });
    }
  });
});

describe("reading files", () => {
  it("lists and downloads files for anyone who sees the candidate, and records the download", async () => {
    const file = await upload(pdf);

    expect((await listResumeFiles(interviewer, t.candidateId)).map((f) => f.id)).toEqual([file.id]);
    const download = await getResumeFileDownload(interviewer, file.id, store);
    expect(download).toMatchObject({ fileName: "resume.pdf", contentType: "application/pdf" });
    expect(download.bytes).toEqual(pdf);
    expect(
      await db.activityLog.count({
        where: { companyId: t.companyId, action: "candidate.resume_download", actorId: interviewer.actorId },
      }),
    ).toBe(1);
  });

  it("hides files of candidates a restricted role can't reach", async () => {
    const file = await upload(pdf, "pool.pdf", poolCandidateId);

    expect(await listResumeFiles(interviewer, poolCandidateId)).toEqual([]);
    await expect(getResumeFileDownload(interviewer, file.id, store)).rejects.toThrow(NotFoundError);
    expect(await listResumeFiles(t.owner, poolCandidateId)).toHaveLength(1);
  });
});

describe("drainResumeQueue", () => {
  it("reads a queued PDF into the candidate's resume text", async () => {
    const file = await upload(pdf);

    expect(await drainResumeQueue({ store })).toEqual({ processed: 1 });

    const parsed = await db.resumeFile.findUniqueOrThrow({ where: { id: file.id } });
    expect(parsed).toMatchObject({ status: "PARSED", extraction: "TEXT", error: null, attempts: 1, lockedAt: null });
    expect(await resumeText()).toContain("two million events a day");
    expect(
      await db.activityLog.findFirst({
        where: { companyId: t.companyId, action: "candidate.resume_parse", entityId: t.candidateId },
        orderBy: { createdAt: "desc" },
      }),
    ).toMatchObject({ actorId: t.owner.actorId });
  });

  it("never lets an older upload overwrite a newer one's text", async () => {
    const older = await upload(pdf, "older.pdf");
    const newer = await upload(docx(RESUME_LINES), "newer.docx");
    await db.resumeFile.update({ where: { id: older.id }, data: { createdAt: new Date(Date.now() - 60_000) } });
    // The newer file is read first...
    await db.resumeFile.update({ where: { id: older.id }, data: { nextAttemptAt: new Date(Date.now() + 60_000) } });
    await drainResumeQueue({ store, parse: async (kind) => ({ text: `${kind} ${RESUME_TEXT}`, extraction: "TEXT" }) });
    expect(await resumeText()).toBe(`DOCX ${RESUME_TEXT}`);

    // ...then the older one finishes and must not bring its text back.
    await db.resumeFile.update({ where: { id: older.id }, data: { nextAttemptAt: new Date() } });
    await drainResumeQueue({ store, parse: async (kind) => ({ text: `${kind} ${RESUME_TEXT}`, extraction: "TEXT" }) });
    expect(await resumeText()).toBe(`DOCX ${RESUME_TEXT}`);
    expect((await db.resumeFile.findUniqueOrThrow({ where: { id: older.id } })).status).toBe("PARSED");
    expect((await db.resumeFile.findUniqueOrThrow({ where: { id: newer.id } })).status).toBe("PARSED");
  });

  it("fails an unreadable file with the reader's reason and leaves the resume text alone", async () => {
    const before = await resumeText();
    const file = await upload(pdf);

    await drainResumeQueue({
      store,
      parse: async () => {
        throw new UnreadableResumeError("This PDF is password-protected.");
      },
    });

    expect(await db.resumeFile.findUniqueOrThrow({ where: { id: file.id } })).toMatchObject({
      status: "FAILED",
      error: "This PDF is password-protected.",
    });
    expect(await resumeText()).toBe(before);
  });

  it("retries a storage outage with backoff, then gives up with a safe message", async () => {
    const file = await upload(pdf);
    const flaky: BlobStore = { ...store, get: async () => Promise.reject(new Error("ECONNRESET")) };

    await drainResumeQueue({ store: flaky, parse: quickParse });
    const retried = await db.resumeFile.findUniqueOrThrow({ where: { id: file.id } });
    expect(retried).toMatchObject({ status: "QUEUED", attempts: 1, lockedAt: null });
    expect(retried.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

    await db.resumeFile.update({ where: { id: file.id }, data: { attempts: 2, nextAttemptAt: new Date() } });
    await drainResumeQueue({ store: flaky, parse: quickParse });
    expect(await db.resumeFile.findUniqueOrThrow({ where: { id: file.id } })).toMatchObject({
      status: "FAILED",
      attempts: 3,
      error: expect.stringContaining("Upload it again"),
    });
  });

  it("fails a file whose original went missing", async () => {
    const file = await upload(pdf);
    store.blobs.clear();

    await drainResumeQueue({ store, parse: quickParse });
    expect(await db.resumeFile.findUniqueOrThrow({ where: { id: file.id } })).toMatchObject({
      status: "FAILED",
      error: "The uploaded file is missing from storage. Upload it again.",
    });
  });

  it("puts a file abandoned by a dead worker back in the queue", async () => {
    const file = await upload(pdf);
    await db.resumeFile.update({
      where: { id: file.id },
      data: { status: "RUNNING", attempts: 1, lockedAt: new Date(Date.now() - 10 * 60_000) },
    });

    await drainResumeQueue({ store, parse: quickParse });
    expect(await db.resumeFile.findUniqueOrThrow({ where: { id: file.id } })).toMatchObject({
      status: "PARSED",
      attempts: 2,
    });
  });
});

describe("deleteCandidate", () => {
  it("erases the candidate's stored files with them", async () => {
    const candidate = await createCandidate(
      t.owner,
      candidateCreateSchema.parse({
        name: "Leaving Candidate",
        email: `leaving-${randomUUID().slice(0, 8)}@example.test`,
        source: "MANUAL",
        resumeText: RESUME_TEXT,
      }),
    );
    const file = await upload(pdf, "r.pdf", candidate.id);
    const kept = await upload(pdf, "kept.pdf");

    await deleteCandidate(t.owner, candidate.id, store);

    expect(await db.resumeFile.findUnique({ where: { id: file.id } })).toBeNull();
    expect(store.blobs.has(file.blobKey)).toBe(false);
    expect(store.blobs.has(kept.blobKey)).toBe(true);
  });
});
