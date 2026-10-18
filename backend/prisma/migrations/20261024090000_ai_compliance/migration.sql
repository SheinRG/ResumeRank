-- AI compliance: candidate notice and opt-out, PII redaction before scoring,
-- voluntary self-identification for bias audits, and scoring records that
-- no role can rewrite once finished.
--
-- Expand only: new nullable or defaulted columns, a new table, and triggers
-- that refuse changes the code never makes.

-- CreateEnum
CREATE TYPE "SelfIdSex" AS ENUM ('FEMALE', 'MALE');

-- CreateEnum
CREATE TYPE "SelfIdRace" AS ENUM ('HISPANIC_OR_LATINO', 'WHITE', 'BLACK_OR_AFRICAN_AMERICAN', 'NATIVE_HAWAIIAN_OR_PACIFIC_ISLANDER', 'ASIAN', 'AMERICAN_INDIAN_OR_ALASKA_NATIVE', 'TWO_OR_MORE_RACES');

-- AlterTable
ALTER TABLE "Candidate" ADD COLUMN     "aiNoticeAt" TIMESTAMP(3),
ADD COLUMN     "aiOptOutAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "aiNoticeRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "aiNoticeText" TEXT,
ADD COLUMN     "aiRedactPii" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ScoringRun" ADD COLUMN     "input" JSONB,
ADD COLUMN     "redacted" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "SelfIdResponse" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "sex" "SelfIdSex",
    "race" "SelfIdRace",
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SelfIdResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SelfIdResponse_applicationId_key" ON "SelfIdResponse"("applicationId");

-- CreateIndex
CREATE INDEX "SelfIdResponse_companyId_idx" ON "SelfIdResponse"("companyId");

-- AddForeignKey
ALTER TABLE "SelfIdResponse" ADD CONSTRAINT "SelfIdResponse_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelfIdResponse" ADD CONSTRAINT "SelfIdResponse_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Self-ID answers are written through a candidate's signed link and read only
-- in aggregate, both inside tenant transactions (services/fairness.ts).
GRANT SELECT, INSERT, UPDATE ON "SelfIdResponse" TO resumerank_tenant;

ALTER TABLE "SelfIdResponse" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SelfIdResponse" TO resumerank_tenant
  USING ("companyId" = current_setting('app.company_id', true));

-- A finished scoring run and its evaluations are the record of what the AI
-- told a recruiter, so they can't be rewritten by any role, the owner
-- included. Allowed: work on a run that hasn't finished, deleting rows along
-- with their application or company (a cascade, so one trigger level down),
-- the foreign keys clearing a deleted user or requirement, and maintenance
-- that sets app.scoring_maintenance.
CREATE FUNCTION scoring_record_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  nullable_link TEXT := CASE TG_TABLE_NAME WHEN 'ScoringRun' THEN 'actorId' ELSE 'requirementId' END;
BEGIN
  IF current_setting('app.scoring_maintenance', true) = 'on' THEN
    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  -- Evaluations have no status, so this only ever matches unfinished runs.
  IF to_jsonb(OLD) ->> 'status' IN ('QUEUED', 'RUNNING') THEN
    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() > 1 THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Finished scoring records cannot be deleted.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF to_jsonb(NEW) ->> nullable_link IS NULL
     AND (to_jsonb(NEW) - nullable_link) = (to_jsonb(OLD) - nullable_link) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Finished scoring records cannot be changed.' USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER scoring_run_guard
  BEFORE UPDATE OR DELETE ON "ScoringRun"
  FOR EACH ROW EXECUTE FUNCTION scoring_record_guard();

CREATE TRIGGER evaluation_guard
  BEFORE UPDATE OR DELETE ON "Evaluation"
  FOR EACH ROW EXECUTE FUNCTION scoring_record_guard();
