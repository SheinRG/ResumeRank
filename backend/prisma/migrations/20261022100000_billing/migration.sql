-- Billing: plans, Stripe subscriptions and the usage meter's cursor.
--
-- Expand only. Every company that exists now is grandfathered onto a comped
-- Enterprise plan, so nothing it uses today goes away; companies created
-- later, by this release or the previous one, have no row and start on Free.
-- Plans only bind once STRIPE_SECRET_KEY is set.

-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('FREE', 'TEAM', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'TRIALING', 'PAST_DUE', 'UNPAID', 'CANCELED', 'INCOMPLETE', 'INCOMPLETE_EXPIRED', 'PAUSED');

-- CreateTable
CREATE TABLE "BillingAccount" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "plan" "Plan" NOT NULL DEFAULT 'FREE',
    "status" "SubscriptionStatus",
    "seats" INTEGER,
    "comped" BOOLEAN NOT NULL DEFAULT false,
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "stripePriceId" TEXT,
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "pastDueSince" TIMESTAMP(3),
    "meteredThrough" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StripeEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StripeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingAccount_companyId_key" ON "BillingAccount"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingAccount_stripeCustomerId_key" ON "BillingAccount"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingAccount_stripeSubscriptionId_key" ON "BillingAccount"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "ScoringRun_companyId_finishedAt_idx" ON "ScoringRun"("companyId", "finishedAt");

-- AddForeignKey
ALTER TABLE "BillingAccount" ADD CONSTRAINT "BillingAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;


INSERT INTO "BillingAccount" ("id", "companyId", "plan", "comped", "updatedAt")
SELECT 'grandfathered_' || "id", "id", 'ENTERPRISE', true, CURRENT_TIMESTAMP FROM "Company";

-- Tenants read their account and may attach a Stripe customer to it, nothing
-- more: the plan, seats and status only change through the webhook, which
-- connects as the owner. Prisma writes column defaults explicitly, so the
-- tenant may insert plan and comped, and the trigger below holds a tenant's
-- insert to a plain Free row.
GRANT SELECT ON "BillingAccount" TO resumerank_tenant;
GRANT INSERT ("id", "companyId", "plan", "comped", "stripeCustomerId", "cancelAtPeriodEnd", "createdAt", "updatedAt")
  ON "BillingAccount" TO resumerank_tenant;
GRANT UPDATE ("stripeCustomerId", "updatedAt") ON "BillingAccount" TO resumerank_tenant;

CREATE FUNCTION billing_account_tenant_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'resumerank_tenant' AND (NEW."plan" <> 'FREE' OR NEW."comped" OR NEW."cancelAtPeriodEnd") THEN
    RAISE EXCEPTION 'permission denied: a workspace can''t choose its own plan' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER billing_account_tenant_insert BEFORE INSERT ON "BillingAccount"
  FOR EACH ROW EXECUTE FUNCTION billing_account_tenant_insert();

ALTER TABLE "BillingAccount" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "BillingAccount" TO resumerank_tenant
  USING ("companyId" = current_setting('app.company_id', true));
