-- Staff backoffice: who ResumeRank staff are, what they did, workspace
-- suspension, and support sessions a workspace's owners consent to.
--
-- Expand only: two nullable Company columns and three new tables that only
-- this release reads.

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('SUPPORT', 'ADMIN');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "supportAccessUntil" TIMESTAMP(3),
ADD COLUMN     "suspendedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "StaffMember" (
    "userId" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffMember_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "StaffAuditEntry" (
    "id" TEXT NOT NULL,
    "staffUserId" TEXT,
    "staffEmail" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "companyId" TEXT,
    "targetUserId" TEXT,
    "summary" TEXT NOT NULL,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffAuditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportSession" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "staffUserId" TEXT NOT NULL,
    "staffName" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "targetName" TEXT NOT NULL,
    "loginId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "SupportSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffAuditEntry_createdAt_id_idx" ON "StaffAuditEntry"("createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "StaffAuditEntry_companyId_createdAt_idx" ON "StaffAuditEntry"("companyId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "SupportSession_loginId_idx" ON "SupportSession"("loginId");

-- CreateIndex
CREATE INDEX "SupportSession_companyId_startedAt_idx" ON "SupportSession"("companyId", "startedAt" DESC);

-- AddForeignKey
ALTER TABLE "StaffMember" ADD CONSTRAINT "StaffMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportSession" ADD CONSTRAINT "SupportSession_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Suspension and the AI budget are set by staff only, on the owner
-- connection (staff/companies.ts). The tenant role may update the rest of
-- its company row, so these columns are guarded rather than left out of a
-- grant list every new column would have to join.
CREATE FUNCTION company_staff_columns() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'resumerank_tenant'
     AND (NEW."suspendedAt", NEW."aiTokenBudget") IS DISTINCT FROM (OLD."suspendedAt", OLD."aiTokenBudget") THEN
    RAISE EXCEPTION 'Only ResumeRank staff can change that.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER company_staff_columns
  BEFORE UPDATE OF "suspendedAt", "aiTokenBudget" ON "Company"
  FOR EACH ROW EXECUTE FUNCTION company_staff_columns();

-- What staff did can't be rewritten by staff, or by anyone else.
CREATE FUNCTION staff_audit_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'The staff audit log is append-only.' USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER staff_audit_guard
  BEFORE UPDATE OR DELETE ON "StaffAuditEntry"
  FOR EACH ROW EXECUTE FUNCTION staff_audit_guard();

CREATE TRIGGER staff_audit_guard_truncate
  BEFORE TRUNCATE ON "StaffAuditEntry"
  FOR EACH STATEMENT EXECUTE FUNCTION staff_audit_guard();

-- Owners read their workspace's support sessions and end them when they
-- withdraw access (services/support-access.ts); staff start them on the
-- owner connection. The staff tables get no grant: tenants never see them.
GRANT SELECT, UPDATE ("endedAt") ON "SupportSession" TO resumerank_tenant;

ALTER TABLE "SupportSession" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SupportSession" TO resumerank_tenant
  USING ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "StaffAuditEntry" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "StaffAuditEntry" TO resumerank_tenant
  USING ("companyId" = current_setting('app.company_id', true));
