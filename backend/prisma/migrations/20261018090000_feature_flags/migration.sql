-- Per-company feature flag overrides, set by staff through the flags CLI.
--
-- Expand only: a new table nothing reads until this release, and every flag
-- that gates an existing feature defaults to on, so no tenant loses anything.

-- CreateTable
CREATE TABLE "FeatureFlagOverride" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "flag" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureFlagOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FeatureFlagOverride_companyId_flag_key" ON "FeatureFlagOverride"("companyId", "flag");

-- AddForeignKey
ALTER TABLE "FeatureFlagOverride" ADD CONSTRAINT "FeatureFlagOverride_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenants read their overrides; only staff, connecting as the owner, write them.
GRANT SELECT ON "FeatureFlagOverride" TO resumerank_tenant;

ALTER TABLE "FeatureFlagOverride" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "FeatureFlagOverride" TO resumerank_tenant
  USING ("companyId" = current_setting('app.company_id', true));
