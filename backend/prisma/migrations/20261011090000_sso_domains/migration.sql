-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "ssoEnforced" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CompanyDomain" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "verificationToken" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "autoJoin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SsoRecord" (
    "key" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "iv" TEXT,
    "tag" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifiedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SsoRecord_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "SsoRecordIndex" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "recordKey" TEXT NOT NULL,

    CONSTRAINT "SsoRecordIndex_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanyDomain_companyId_domain_key" ON "CompanyDomain"("companyId", "domain");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyDomain_verified_domain_key" ON "CompanyDomain"("domain") WHERE ("verifiedAt" IS NOT NULL);

-- CreateIndex
CREATE INDEX "SsoRecord_namespace_createdAt_idx" ON "SsoRecord"("namespace", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "SsoRecord_expiresAt_idx" ON "SsoRecord"("expiresAt");

-- CreateIndex
CREATE INDEX "SsoRecordIndex_recordKey_idx" ON "SsoRecordIndex"("recordKey");

-- CreateIndex
CREATE UNIQUE INDEX "SsoRecordIndex_key_recordKey_key" ON "SsoRecordIndex"("key", "recordKey");

-- AddForeignKey
ALTER TABLE "CompanyDomain" ADD CONSTRAINT "CompanyDomain_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SsoRecordIndex" ADD CONSTRAINT "SsoRecordIndex_recordKey_fkey" FOREIGN KEY ("recordKey") REFERENCES "SsoRecord"("key") ON DELETE CASCADE ON UPDATE CASCADE;


-- Domains are managed inside tenant transactions. The SSO sign-in lookup
-- (backend/src/sso/login.ts) runs before there is a tenant and stays on the
-- owner connection.
GRANT SELECT, INSERT, UPDATE, DELETE ON "CompanyDomain" TO resumerank_tenant;

ALTER TABLE "CompanyDomain" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CompanyDomain" TO resumerank_tenant
  USING ("companyId" = current_setting('app.company_id', true));

-- SsoRecord / SsoRecordIndex hold every tenant's IdP configuration and are
-- only ever touched by the SSO service on the owner connection, so the tenant
-- role gets no grant on them.
