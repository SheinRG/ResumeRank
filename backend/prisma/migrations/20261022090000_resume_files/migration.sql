-- Resume file ingestion: each uploaded original (kept in blob storage for
-- audit) and its parse job, worked by a Postgres queue like ScoringRun.
--
-- Expand only: a new table and new enums nothing reads until this release.

-- CreateEnum
CREATE TYPE "ResumeFileStatus" AS ENUM ('QUEUED', 'RUNNING', 'PARSED', 'FAILED');

-- CreateEnum
CREATE TYPE "ResumeFileKind" AS ENUM ('PDF', 'DOCX');

-- CreateEnum
CREATE TYPE "ResumeExtraction" AS ENUM ('TEXT', 'OCR');

-- CreateTable
CREATE TABLE "ResumeFile" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "uploadedById" TEXT,
    "blobKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "kind" "ResumeFileKind" NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "status" "ResumeFileStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "extraction" "ResumeExtraction",
    "extractedChars" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResumeFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ResumeFile_blobKey_key" ON "ResumeFile"("blobKey");

-- CreateIndex
CREATE INDEX "ResumeFile_status_nextAttemptAt_idx" ON "ResumeFile"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "ResumeFile_companyId_candidateId_createdAt_idx" ON "ResumeFile"("companyId", "candidateId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ResumeFile_candidateId_idx" ON "ResumeFile"("candidateId");

-- CreateIndex
CREATE INDEX "ResumeFile_uploadedById_idx" ON "ResumeFile"("uploadedById");

-- AddForeignKey
ALTER TABLE "ResumeFile" ADD CONSTRAINT "ResumeFile_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResumeFile" ADD CONSTRAINT "ResumeFile_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResumeFile" ADD CONSTRAINT "ResumeFile_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Tenants upload and read files; the queue worker updates them as the owner.
-- No DELETE: a file goes only with its candidate or company, by cascade.
GRANT SELECT, INSERT, UPDATE ON "ResumeFile" TO resumerank_tenant;

ALTER TABLE "ResumeFile" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ResumeFile" TO resumerank_tenant
  USING ("companyId" = current_setting('app.company_id', true));
