-- Granular RBAC: hiring managers and interviewers, who reach only the jobs
-- they're assigned to, directly (JobAssignment) or through a department
-- (DepartmentMember on the job's Department).
--
-- Expand only. Nobody holds the new roles until the release that knows them
-- assigns one, and the previous release treats an unknown role as read-only.

-- AlterEnum
-- Added values can't be used in the transaction that adds them; nothing
-- below does.
ALTER TYPE "Role" ADD VALUE 'HIRING_MANAGER' BEFORE 'VIEWER';
ALTER TYPE "Role" ADD VALUE 'INTERVIEWER' BEFORE 'VIEWER';

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "departmentId" TEXT;

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepartmentMember" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DepartmentMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobAssignment" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Department_companyId_name_key" ON "Department"("companyId", "name");

-- CreateIndex
CREATE INDEX "DepartmentMember_companyId_userId_idx" ON "DepartmentMember"("companyId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "DepartmentMember_departmentId_userId_key" ON "DepartmentMember"("departmentId", "userId");

-- CreateIndex
CREATE INDEX "JobAssignment_companyId_userId_idx" ON "JobAssignment"("companyId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "JobAssignment_jobId_userId_key" ON "JobAssignment"("jobId", "userId");

-- CreateIndex
CREATE INDEX "Job_departmentId_idx" ON "Job"("departmentId");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepartmentMember" ADD CONSTRAINT "DepartmentMember_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepartmentMember" ADD CONSTRAINT "DepartmentMember_userId_companyId_fkey" FOREIGN KEY ("userId", "companyId") REFERENCES "Membership"("userId", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobAssignment" ADD CONSTRAINT "JobAssignment_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobAssignment" ADD CONSTRAINT "JobAssignment_userId_companyId_fkey" FOREIGN KEY ("userId", "companyId") REFERENCES "Membership"("userId", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

GRANT SELECT, INSERT, UPDATE, DELETE ON "Department", "DepartmentMember", "JobAssignment" TO resumerank_tenant;

ALTER TABLE "Department" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Department" TO resumerank_tenant
  USING ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "DepartmentMember" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DepartmentMember" TO resumerank_tenant
  USING ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "JobAssignment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "JobAssignment" TO resumerank_tenant
  USING ("companyId" = current_setting('app.company_id', true));
