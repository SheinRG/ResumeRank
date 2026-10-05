-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- DropIndex
DROP INDEX "ActivityLog_companyId_createdAt_id_idx";

-- DropIndex
DROP INDEX "Application_companyId_stage_createdAt_id_idx";

-- DropIndex
DROP INDEX "Application_jobId_deletedAt_stage_aiScore_idx";

-- DropIndex
DROP INDEX "Candidate_companyId_createdAt_id_idx";

-- DropIndex
DROP INDEX "Candidate_companyId_name_idx";

-- DropIndex
DROP INDEX "Job_companyId_status_createdAt_id_idx";

-- DropIndex
DROP INDEX "Job_companyId_title_idx";

-- AlterTable
-- Generated, so every write path keeps it current without app code; the
-- explicit regconfig makes the expression immutable, as a generated column needs.
ALTER TABLE "Candidate" ADD COLUMN "resumeTsv" tsvector
  GENERATED ALWAYS AS (to_tsvector('english'::regconfig, "resumeText")) STORED;

-- CreateIndex
CREATE INDEX "ActivityLog_companyId_createdAt_id_idx" ON "ActivityLog"("companyId", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "ActivityLog_companyId_entityType_createdAt_id_idx" ON "ActivityLog"("companyId", "entityType", "createdAt" DESC, "id" DESC);

-- CreateIndex
-- NULLS LAST matches the "score" sort, so a ranked page reads straight off
-- the index; the schema can't express null ordering.
CREATE INDEX "Application_jobId_aiScore_id_idx" ON "Application"("jobId", "aiScore" DESC NULLS LAST, "id" DESC) WHERE ("deletedAt" IS NULL);

-- CreateIndex
CREATE INDEX "Application_jobId_createdAt_id_idx" ON "Application"("jobId", "createdAt" DESC, "id" DESC) WHERE ("deletedAt" IS NULL);

-- CreateIndex
CREATE INDEX "Application_companyId_createdAt_id_idx" ON "Application"("companyId", "createdAt" DESC, "id" DESC) WHERE ("deletedAt" IS NULL);

-- CreateIndex
CREATE INDEX "Application_companyId_stage_idx" ON "Application"("companyId", "stage") WHERE ("deletedAt" IS NULL);

-- CreateIndex
CREATE INDEX "Application_companyId_aiScore_idx" ON "Application"("companyId", "aiScore") WHERE ("deletedAt" IS NULL);

-- CreateIndex
CREATE INDEX "Application_createdById_idx" ON "Application"("createdById");

-- CreateIndex
CREATE INDEX "Candidate_companyId_createdAt_id_idx" ON "Candidate"("companyId", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "Candidate_companyId_name_id_idx" ON "Candidate"("companyId", "name", "id");

-- CreateIndex
CREATE INDEX "Candidate_name_trgm_idx" ON "Candidate" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Candidate_email_trgm_idx" ON "Candidate" USING GIN ("email" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Candidate_headline_trgm_idx" ON "Candidate" USING GIN ("headline" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Candidate_resumeTsv_idx" ON "Candidate" USING GIN ("resumeTsv");

-- CreateIndex
CREATE INDEX "Candidate_createdById_idx" ON "Candidate"("createdById");

-- CreateIndex
CREATE INDEX "CompanyInvite_email_idx" ON "CompanyInvite"("email");

-- CreateIndex
CREATE INDEX "CompanyInvite_invitedById_idx" ON "CompanyInvite"("invitedById");

-- CreateIndex
CREATE INDEX "Evaluation_requirementId_idx" ON "Evaluation"("requirementId");

-- CreateIndex
CREATE INDEX "Job_companyId_createdAt_id_idx" ON "Job"("companyId", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "Job_companyId_status_createdAt_id_idx" ON "Job"("companyId", "status", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "Job_companyId_title_id_idx" ON "Job"("companyId", "title", "id");

-- CreateIndex
CREATE INDEX "Job_title_trgm_idx" ON "Job" USING GIN ("title" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Job_createdById_idx" ON "Job"("createdById");

-- CreateIndex
CREATE INDEX "Scorecard_reviewerId_idx" ON "Scorecard"("reviewerId");

