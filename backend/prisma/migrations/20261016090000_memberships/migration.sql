-- Multi-company membership: one account, a role in each of several
-- workspaces. Membership becomes the source of truth for who belongs where;
-- each sign-in records the workspace it has open.
--
-- Expand only. "User"."companyId" and "User"."role" stay, now meaning the
-- workspace a new sign-in opens in and the role there, and two triggers keep
-- them and Membership in step, so code deployed before this migration keeps
-- working against it in either direction.

-- AlterTable
ALTER TABLE "LoginSession" ADD COLUMN     "companyId" TEXT,
ADD COLUMN     "ssoCompanyId" TEXT;

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'MEMBER',
    "directoryUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Membership_companyId_role_idx" ON "Membership"("companyId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_companyId_key" ON "Membership"("userId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_companyId_directoryUserId_key" ON "Membership"("companyId", "directoryUserId");

-- CreateIndex
CREATE INDEX "LoginSession_companyId_idx" ON "LoginSession"("companyId");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoginSession" ADD CONSTRAINT "LoginSession_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoginSession" ADD CONSTRAINT "LoginSession_ssoCompanyId_fkey" FOREIGN KEY ("ssoCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: everyone's current company becomes their first membership, and
-- live sign-ins keep the workspace (and SSO tenant) they had.
INSERT INTO "Membership" ("id", "userId", "companyId", "role", "directoryUserId", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "id", "companyId", "role", "directoryUserId", "createdAt", CURRENT_TIMESTAMP
FROM "User"
WHERE "companyId" IS NOT NULL;

UPDATE "LoginSession" AS s
SET "companyId" = u."companyId",
    "ssoCompanyId" = CASE WHEN s."method" = 'SSO' THEN u."companyId" END
FROM "User" AS u
WHERE u."id" = s."userId" AND u."companyId" IS NOT NULL;

-- Membership -> User: keeps "User"."companyId" pointing at a workspace the
-- user still belongs to, and "User"."role" at their role there. A first
-- membership becomes the default; losing the default falls back to the
-- oldest remaining one. SECURITY DEFINER because a tenant transaction can't
-- see the user's other memberships.
CREATE FUNCTION membership_mirror() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  fallback RECORD;
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE "User" SET "companyId" = NEW."companyId", "role" = NEW."role"
    WHERE "id" = NEW."userId" AND "companyId" IS NULL;
    RETURN NULL;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    UPDATE "User" SET "role" = NEW."role"
    WHERE "id" = NEW."userId" AND "companyId" = NEW."companyId" AND "role" IS DISTINCT FROM NEW."role";
    RETURN NULL;
  END IF;

  SELECT "companyId", "role" INTO fallback
  FROM "Membership"
  WHERE "userId" = OLD."userId" AND "companyId" <> OLD."companyId"
  ORDER BY "createdAt", "id"
  LIMIT 1;
  -- Also when the default is already null: deleting a company clears it
  -- through the foreign key, which may run before this cascade.
  UPDATE "User"
  SET "companyId" = fallback."companyId", "role" = COALESCE(fallback."role", 'MEMBER')
  WHERE "id" = OLD."userId" AND ("companyId" = OLD."companyId" OR "companyId" IS NULL);
  RETURN NULL;
END;
$$;

CREATE TRIGGER membership_mirror
  AFTER INSERT OR UPDATE OF "role" OR DELETE ON "Membership"
  FOR EACH ROW EXECUTE FUNCTION membership_mirror();

-- User -> Membership, for code deployed before memberships, which joins,
-- re-roles and removes people by writing "User"."companyId" and "role"
-- directly. Skipped for the mirror's own writes (nested, depth > 1) and for
-- the one write current code makes, switching the default workspace, which
-- sets app.workspace_switch: replaying that row's role into the membership
-- could undo a role change committed alongside it.
CREATE FUNCTION membership_from_user() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
BEGIN
  IF pg_trigger_depth() > 1 OR current_setting('app.workspace_switch', true) = 'on' THEN
    RETURN NULL;
  END IF;

  IF NEW."companyId" IS NOT NULL THEN
    INSERT INTO "Membership" ("id", "userId", "companyId", "role", "createdAt", "updatedAt")
    VALUES (gen_random_uuid()::text, NEW."id", NEW."companyId", NEW."role", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT ("userId", "companyId") DO UPDATE
      SET "role" = EXCLUDED."role", "updatedAt" = CURRENT_TIMESTAMP
      WHERE "Membership"."role" IS DISTINCT FROM EXCLUDED."role";
  ELSIF TG_OP = 'UPDATE' AND OLD."companyId" IS NOT NULL THEN
    DELETE FROM "Membership" WHERE "userId" = NEW."id" AND "companyId" = OLD."companyId";
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER membership_from_user
  AFTER INSERT OR UPDATE OF "companyId", "role" ON "User"
  FOR EACH ROW EXECUTE FUNCTION membership_from_user();

-- Whether a user belongs to any workspace besides the tenant transaction's.
-- A tenant can't see other companies' memberships, and needs only this
-- answer: to refuse account-wide changes (an MFA reset) to someone another
-- company shares.
CREATE FUNCTION belongs_elsewhere(user_id TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path FROM CURRENT AS $$
  SELECT EXISTS (
    SELECT 1 FROM "Membership"
    WHERE "userId" = user_id
      AND "companyId" IS DISTINCT FROM current_setting('app.company_id', true)
  );
$$;

-- Tenant transactions manage their own company's memberships (roles,
-- removal, SCIM-managed ids) and nobody else's.
GRANT SELECT, INSERT, UPDATE, DELETE ON "Membership" TO resumerank_tenant;

ALTER TABLE "Membership" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Membership" TO resumerank_tenant
  USING ("companyId" = current_setting('app.company_id', true));

-- A user's sessions and second factors are visible to a tenant transaction
-- while the user is a member of that company, wherever else they belong.
DROP POLICY tenant_isolation ON "LoginSession";
CREATE POLICY tenant_isolation ON "LoginSession" TO resumerank_tenant
  USING (EXISTS (
    SELECT 1 FROM "Membership"
    WHERE "Membership"."userId" = "LoginSession"."userId"
      AND "Membership"."companyId" = current_setting('app.company_id', true)
  ));

DROP POLICY tenant_isolation ON "TotpFactor";
CREATE POLICY tenant_isolation ON "TotpFactor" TO resumerank_tenant
  USING (EXISTS (
    SELECT 1 FROM "Membership"
    WHERE "Membership"."userId" = "TotpFactor"."userId"
      AND "Membership"."companyId" = current_setting('app.company_id', true)
  ));

DROP POLICY tenant_isolation ON "WebAuthnCredential";
CREATE POLICY tenant_isolation ON "WebAuthnCredential" TO resumerank_tenant
  USING (EXISTS (
    SELECT 1 FROM "Membership"
    WHERE "Membership"."userId" = "WebAuthnCredential"."userId"
      AND "Membership"."companyId" = current_setting('app.company_id', true)
  ));

DROP POLICY tenant_isolation ON "WebAuthnChallenge";
CREATE POLICY tenant_isolation ON "WebAuthnChallenge" TO resumerank_tenant
  USING (EXISTS (
    SELECT 1 FROM "Membership"
    WHERE "Membership"."userId" = "WebAuthnChallenge"."userId"
      AND "Membership"."companyId" = current_setting('app.company_id', true)
  ));

DROP POLICY tenant_isolation ON "MfaRecoveryCode";
CREATE POLICY tenant_isolation ON "MfaRecoveryCode" TO resumerank_tenant
  USING (EXISTS (
    SELECT 1 FROM "Membership"
    WHERE "Membership"."userId" = "MfaRecoveryCode"."userId"
      AND "Membership"."companyId" = current_setting('app.company_id', true)
  ));
