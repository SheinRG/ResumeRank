-- Resume integrity: text hidden in uploaded PDFs, and evidence that is only
-- a skills-list mention.
--
-- Expand only: columns with constant defaults or nullable, which older code
-- ignores. Existing evaluations keep evidenceListed = false, so their stored
-- verdicts stand as scored.

-- AlterTable
ALTER TABLE "ResumeFile" ADD COLUMN     "hiddenChars" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "hiddenText" TEXT;

-- AlterTable
ALTER TABLE "Evaluation" ADD COLUMN     "evidenceListed" BOOLEAN NOT NULL DEFAULT false;
