-- CreateEnum
CREATE TYPE "SignInMethod" AS ENUM ('PASSWORD', 'GOOGLE', 'SSO');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "sessionIdleMinutes" INTEGER NOT NULL DEFAULT 10080,
ADD COLUMN     "sessionLifetimeMinutes" INTEGER NOT NULL DEFAULT 43200;

-- CreateTable
CREATE TABLE "LoginSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "method" "SignInMethod" NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "LoginSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoginSession_userId_idx" ON "LoginSession"("userId");

-- AddForeignKey
ALTER TABLE "LoginSession" ADD CONSTRAINT "LoginSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Sessions belong to users, not companies. Signing in, the per-request check
-- and self-service revocation run on the owner connection; a tenant
-- transaction only touches them to end a teammate's sessions (removal, MFA
-- reset, admin sign-out), so the tenant role may read and revoke them, and
-- only for users in its own company.
GRANT SELECT, UPDATE ON "LoginSession" TO resumerank_tenant;

ALTER TABLE "LoginSession" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "LoginSession" TO resumerank_tenant
  USING (EXISTS (
    SELECT 1 FROM "User"
    WHERE "User"."id" = "LoginSession"."userId"
      AND "User"."companyId" = current_setting('app.company_id', true)
  ));
