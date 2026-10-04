-- Scoring becomes an append-only history of runs. Existing scores are kept:
-- each scored application gets one "legacy" SUCCEEDED run that takes over its
-- evaluations and becomes its latest run.

-- CreateEnum
CREATE TYPE "ScoringRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "ScoringRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "actorId" TEXT,
    "status" "ScoringRunStatus" NOT NULL DEFAULT 'QUEUED',
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "temperature" DOUBLE PRECISION NOT NULL,
    "inputHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "aiScore" INTEGER,
    "aiSummary" TEXT,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "latencyMs" INTEGER,
    "rawOutput" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScoringRun_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Application" ADD COLUMN "latestScoringRunId" TEXT;

-- AlterTable
ALTER TABLE "Evaluation" ADD COLUMN "scoringRunId" TEXT;

-- Backfill: one legacy run per application that has a score or evaluations.
-- The "legacy" hash never equals a real input hash, so it is never reused.
INSERT INTO "ScoringRun" (
    "id", "companyId", "applicationId", "status", "model", "promptVersion",
    "temperature", "inputHash", "attempts", "nextAttemptAt", "finishedAt",
    "aiScore", "aiSummary", "createdAt", "updatedAt"
)
SELECT
    'legacy_' || a."id", a."companyId", a."id", 'SUCCEEDED', 'unknown', 'legacy',
    0.2, 'legacy', 1, COALESCE(a."scoredAt", a."updatedAt"), COALESCE(a."scoredAt", a."updatedAt"),
    a."aiScore", a."aiSummary", COALESCE(a."scoredAt", a."updatedAt"), CURRENT_TIMESTAMP
FROM "Application" a
WHERE a."aiScore" IS NOT NULL
   OR EXISTS (SELECT 1 FROM "Evaluation" e WHERE e."applicationId" = a."id");

UPDATE "Evaluation" SET "scoringRunId" = 'legacy_' || "applicationId";

UPDATE "Application" a
SET "latestScoringRunId" = 'legacy_' || a."id"
WHERE EXISTS (SELECT 1 FROM "ScoringRun" r WHERE r."id" = 'legacy_' || a."id");

ALTER TABLE "Evaluation" ALTER COLUMN "scoringRunId" SET NOT NULL;

-- DropForeignKey
ALTER TABLE "Evaluation" DROP CONSTRAINT "Evaluation_applicationId_fkey";

-- DropIndex
DROP INDEX "Evaluation_applicationId_idx";

-- AlterTable
ALTER TABLE "Evaluation" DROP COLUMN "applicationId";

-- CreateIndex
CREATE INDEX "ScoringRun_status_nextAttemptAt_idx" ON "ScoringRun"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "ScoringRun_companyId_status_idx" ON "ScoringRun"("companyId", "status");

-- CreateIndex
CREATE INDEX "ScoringRun_applicationId_createdAt_idx" ON "ScoringRun"("applicationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ScoringRun_companyId_inputHash_idx" ON "ScoringRun"("companyId", "inputHash");

-- CreateIndex
CREATE INDEX "ScoringRun_actorId_idx" ON "ScoringRun"("actorId");

-- CreateIndex
CREATE UNIQUE INDEX "Application_latestScoringRunId_key" ON "Application"("latestScoringRunId");

-- CreateIndex
CREATE INDEX "Evaluation_scoringRunId_idx" ON "Evaluation"("scoringRunId");

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_latestScoringRunId_fkey" FOREIGN KEY ("latestScoringRunId") REFERENCES "ScoringRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_scoringRunId_fkey" FOREIGN KEY ("scoringRunId") REFERENCES "ScoringRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoringRun" ADD CONSTRAINT "ScoringRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoringRun" ADD CONSTRAINT "ScoringRun_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoringRun" ADD CONSTRAINT "ScoringRun_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
