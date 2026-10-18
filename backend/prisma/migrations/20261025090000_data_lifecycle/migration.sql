-- Data lifecycle: how long a company keeps candidates before the scheduled
-- purge deletes them (retention/candidates.ts).
--
-- Expand only: a nullable column; null keeps candidates until deleted by hand.

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "candidateRetentionDays" INTEGER;

