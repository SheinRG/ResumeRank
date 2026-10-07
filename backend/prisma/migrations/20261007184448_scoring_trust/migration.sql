-- CreateEnum
CREATE TYPE "EvidenceStatus" AS ENUM ('VERIFIED', 'UNVERIFIED', 'NONE');

-- AlterTable
ALTER TABLE "Evaluation" ADD COLUMN     "evidenceStatus" "EvidenceStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "modelVerdict" "Verdict";

-- AlterTable
ALTER TABLE "ScoringRun" ADD COLUMN     "injectionSignals" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "seed" INTEGER;

-- Backfill: earlier runs dropped any quote that failed the verbatim check, so
-- a stored quote on those rows was verified. modelVerdict stays null there:
-- what the model originally said wasn't recorded.
UPDATE "Evaluation" SET "evidenceStatus" = 'VERIFIED' WHERE "evidence" IS NOT NULL;
