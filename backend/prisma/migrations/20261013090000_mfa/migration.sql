-- CreateEnum
CREATE TYPE "WebAuthnCeremony" AS ENUM ('REGISTRATION', 'AUTHENTICATION');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "mfaRequired" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mfaEnabledAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "TotpFactor" (
    "userId" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "lastUsedStep" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TotpFactor_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "WebAuthnCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "transports" TEXT[],
    "name" TEXT NOT NULL,
    "backedUp" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "WebAuthnCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebAuthnChallenge" (
    "userId" TEXT NOT NULL,
    "ceremony" "WebAuthnCeremony" NOT NULL,
    "challenge" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebAuthnChallenge_pkey" PRIMARY KEY ("userId","ceremony")
);

-- CreateTable
CREATE TABLE "MfaRecoveryCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MfaRecoveryCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WebAuthnCredential_credentialId_key" ON "WebAuthnCredential"("credentialId");

-- CreateIndex
CREATE INDEX "WebAuthnCredential_userId_idx" ON "WebAuthnCredential"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MfaRecoveryCode_userId_codeHash_key" ON "MfaRecoveryCode"("userId", "codeHash");

-- AddForeignKey
ALTER TABLE "TotpFactor" ADD CONSTRAINT "TotpFactor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebAuthnCredential" ADD CONSTRAINT "WebAuthnCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebAuthnChallenge" ADD CONSTRAINT "WebAuthnChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MfaRecoveryCode" ADD CONSTRAINT "MfaRecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Second factors belong to users, not companies. Enrolment and sign-in
-- checks run on the owner connection; a tenant transaction only touches them
-- to reset a teammate (backend/src/services/mfa.ts), so the tenant role may
-- read and delete them, and only for users in its own company.
GRANT SELECT, DELETE
  ON "TotpFactor", "WebAuthnCredential", "WebAuthnChallenge", "MfaRecoveryCode"
  TO resumerank_tenant;

ALTER TABLE "TotpFactor" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TotpFactor" TO resumerank_tenant
  USING (EXISTS (
    SELECT 1 FROM "User"
    WHERE "User"."id" = "TotpFactor"."userId"
      AND "User"."companyId" = current_setting('app.company_id', true)
  ));

ALTER TABLE "WebAuthnCredential" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WebAuthnCredential" TO resumerank_tenant
  USING (EXISTS (
    SELECT 1 FROM "User"
    WHERE "User"."id" = "WebAuthnCredential"."userId"
      AND "User"."companyId" = current_setting('app.company_id', true)
  ));

ALTER TABLE "WebAuthnChallenge" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WebAuthnChallenge" TO resumerank_tenant
  USING (EXISTS (
    SELECT 1 FROM "User"
    WHERE "User"."id" = "WebAuthnChallenge"."userId"
      AND "User"."companyId" = current_setting('app.company_id', true)
  ));

ALTER TABLE "MfaRecoveryCode" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "MfaRecoveryCode" TO resumerank_tenant
  USING (EXISTS (
    SELECT 1 FROM "User"
    WHERE "User"."id" = "MfaRecoveryCode"."userId"
      AND "User"."companyId" = current_setting('app.company_id', true)
  ));
