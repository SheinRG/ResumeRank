-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logoUrl" TEXT,
    "website" TEXT,
    "description" TEXT,
    "industry" TEXT,
    "size" TEXT,
    "location" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_slug_key" ON "Company"("slug");

-- CreateTable
CREATE TABLE "CompanyInvite" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'MEMBER',
    "tokenHash" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanyInvite_tokenHash_key" ON "CompanyInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "CompanyInvite_companyId_createdAt_idx" ON "CompanyInvite"("companyId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "CompanyInvite_companyId_email_key" ON "CompanyInvite"("companyId", "email");

-- AlterTable: add the new companyId columns nullable first so existing rows
-- aren't rejected before the backfill below can populate them.
ALTER TABLE "User" ADD COLUMN "companyId" TEXT;
ALTER TABLE "Job" ADD COLUMN "companyId" TEXT;
ALTER TABLE "Candidate" ADD COLUMN "companyId" TEXT;
ALTER TABLE "Application" ADD COLUMN "companyId" TEXT;
ALTER TABLE "ActivityLog" ADD COLUMN "companyId" TEXT;

-- Backfill: a brand-new (empty) database has nothing to attach to a company,
-- so only create the fallback company when pre-existing rows actually need one.
INSERT INTO "Company" ("id", "name", "slug", "createdAt", "updatedAt")
SELECT 'default-company', 'Default Company', 'default', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "User")
  AND NOT EXISTS (SELECT 1 FROM "Company" WHERE "id" = 'default-company');

UPDATE "User" SET "companyId" = 'default-company'
WHERE "companyId" IS NULL AND EXISTS (SELECT 1 FROM "Company" WHERE "id" = 'default-company');

UPDATE "Job" SET "companyId" = 'default-company'
WHERE "companyId" IS NULL AND EXISTS (SELECT 1 FROM "Company" WHERE "id" = 'default-company');

UPDATE "Candidate" SET "companyId" = 'default-company'
WHERE "companyId" IS NULL AND EXISTS (SELECT 1 FROM "Company" WHERE "id" = 'default-company');

UPDATE "Application" SET "companyId" = 'default-company'
WHERE "companyId" IS NULL AND EXISTS (SELECT 1 FROM "Company" WHERE "id" = 'default-company');

UPDATE "ActivityLog" SET "companyId" = 'default-company'
WHERE "companyId" IS NULL AND EXISTS (SELECT 1 FROM "Company" WHERE "id" = 'default-company');

-- AlterTable: now that every existing row has a companyId, enforce it. User
-- stays nullable — OAuth-created users have no company until onboarding.
ALTER TABLE "Job" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "Candidate" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "Application" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "ActivityLog" ALTER COLUMN "companyId" SET NOT NULL;

-- DropIndex
DROP INDEX "ActivityLog_createdAt_id_idx";

-- DropIndex
DROP INDEX "ActivityLog_entityType_entityId_createdAt_idx";

-- DropIndex
DROP INDEX "Application_stage_createdAt_id_idx";

-- DropIndex
DROP INDEX "Candidate_createdAt_id_idx";

-- DropIndex
DROP INDEX "Candidate_email_key";

-- DropIndex
DROP INDEX "Candidate_name_idx";

-- DropIndex
DROP INDEX "Job_status_createdAt_id_idx";

-- DropIndex
DROP INDEX "Job_title_idx";

-- CreateIndex
CREATE INDEX "ActivityLog_companyId_entityType_entityId_createdAt_idx" ON "ActivityLog"("companyId", "entityType", "entityId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ActivityLog_companyId_createdAt_id_idx" ON "ActivityLog"("companyId", "createdAt" DESC, "id");

-- CreateIndex
CREATE INDEX "Application_companyId_stage_createdAt_id_idx" ON "Application"("companyId", "stage", "createdAt" DESC, "id");

-- CreateIndex
CREATE INDEX "Candidate_companyId_name_idx" ON "Candidate"("companyId", "name");

-- CreateIndex
CREATE INDEX "Candidate_companyId_createdAt_id_idx" ON "Candidate"("companyId", "createdAt" DESC, "id");

-- CreateIndex
CREATE UNIQUE INDEX "Candidate_companyId_email_key" ON "Candidate"("companyId", "email");

-- CreateIndex
CREATE INDEX "Job_companyId_status_createdAt_id_idx" ON "Job"("companyId", "status", "createdAt" DESC, "id");

-- CreateIndex
CREATE INDEX "Job_companyId_title_idx" ON "Job"("companyId", "title");

-- CreateIndex
CREATE INDEX "User_companyId_idx" ON "User"("companyId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyInvite" ADD CONSTRAINT "CompanyInvite_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyInvite" ADD CONSTRAINT "CompanyInvite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
