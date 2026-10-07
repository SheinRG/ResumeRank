-- Row-level security for tenant transactions.
--
-- The policies bind only "resumerank_tenant", a NOLOGIN role the app assumes
-- with SET LOCAL ROLE inside tenantTransaction() (backend/src/tenant-db.ts),
-- alongside the transaction-local "app.company_id" setting. Every other
-- connection keeps the owner's privileges, and owners bypass RLS, so auth,
-- onboarding and the cross-tenant scoring claim are unaffected.

-- CreateRole
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'resumerank_tenant') THEN
    CREATE ROLE resumerank_tenant NOLOGIN;
  END IF;
END
$$;

-- Postgres 16 gives a non-superuser creator ADMIN on the new role but not
-- SET, so the connecting role grants itself the membership SET ROLE needs.
GRANT resumerank_tenant TO CURRENT_USER;

-- Grants: only the tables tenant transactions touch. A new table used inside
-- one fails with "permission denied" until its migration grants it.
GRANT USAGE ON SCHEMA public TO resumerank_tenant;
GRANT SELECT, UPDATE ON "User", "Company" TO resumerank_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON "CompanyInvite", "Job", "JobRequirement", "Candidate", "Application", "ScoringRun", "Scorecard"
  TO resumerank_tenant;
-- Append-only: the audit trail and scoring evidence can't be rewritten from
-- a tenant transaction. Cascades from a deleted parent run as the owner.
GRANT SELECT, INSERT ON "ActivityLog", "Evaluation" TO resumerank_tenant;

-- Policies. Without the setting, current_setting(..., true) is NULL and no
-- row matches, so a tenant transaction that forgot its company sees nothing.
ALTER TABLE "Company" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Company" TO resumerank_tenant
  USING ("id" = current_setting('app.company_id', true));

ALTER TABLE "CompanyInvite" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CompanyInvite" TO resumerank_tenant
  USING ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "Job" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Job" TO resumerank_tenant
  USING ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "Candidate" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Candidate" TO resumerank_tenant
  USING ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "ActivityLog" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ActivityLog" TO resumerank_tenant
  USING ("companyId" = current_setting('app.company_id', true));

-- Foreign-key checks ignore RLS, so the parent lookups are what stop a row
-- in one tenant pointing at another tenant's job, candidate or application.
ALTER TABLE "Application" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Application" TO resumerank_tenant
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK (
    "companyId" = current_setting('app.company_id', true)
    AND EXISTS (SELECT 1 FROM "Job" WHERE "Job"."id" = "Application"."jobId")
    AND EXISTS (SELECT 1 FROM "Candidate" WHERE "Candidate"."id" = "Application"."candidateId")
  );

ALTER TABLE "ScoringRun" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ScoringRun" TO resumerank_tenant
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK (
    "companyId" = current_setting('app.company_id', true)
    AND EXISTS (SELECT 1 FROM "Application" WHERE "Application"."id" = "ScoringRun"."applicationId")
  );

-- Child tables carry no companyId; they inherit the tenant through a parent
-- that is itself filtered by its own policy.
ALTER TABLE "JobRequirement" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "JobRequirement" TO resumerank_tenant
  USING (EXISTS (SELECT 1 FROM "Job" WHERE "Job"."id" = "JobRequirement"."jobId"));

ALTER TABLE "Scorecard" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Scorecard" TO resumerank_tenant
  USING (EXISTS (SELECT 1 FROM "Application" WHERE "Application"."id" = "Scorecard"."applicationId"));

ALTER TABLE "Evaluation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Evaluation" TO resumerank_tenant
  USING (EXISTS (SELECT 1 FROM "ScoringRun" WHERE "ScoringRun"."id" = "Evaluation"."scoringRunId"));
