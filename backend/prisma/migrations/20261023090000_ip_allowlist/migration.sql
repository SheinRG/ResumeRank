-- IP allowlisting: the networks a company's members may use it from.
--
-- Expand only: a new table nothing reads until this release.

-- CreateTable
CREATE TABLE "IpAllowlistEntry" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "cidr" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IpAllowlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IpAllowlistEntry_companyId_cidr_key" ON "IpAllowlistEntry"("companyId", "cidr");

-- AddForeignKey
ALTER TABLE "IpAllowlistEntry" ADD CONSTRAINT "IpAllowlistEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Owners manage ranges in tenant transactions (services/ip-allowlist.ts). The
-- guards and API authentication read them across tenants on the owner
-- connection, since they run before a tenant is established.
GRANT SELECT, INSERT, DELETE ON "IpAllowlistEntry" TO resumerank_tenant;

ALTER TABLE "IpAllowlistEntry" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "IpAllowlistEntry" TO resumerank_tenant
  USING ("companyId" = current_setting('app.company_id', true));
