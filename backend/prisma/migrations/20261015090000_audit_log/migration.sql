-- CreateEnum
CREATE TYPE "AuditStreamKind" AS ENUM ('WEBHOOK', 'SPLUNK', 'DATADOG');

-- AlterTable
ALTER TABLE "ActivityLog" ADD COLUMN     "hash" TEXT,
ADD COLUMN     "prevHash" TEXT,
ADD COLUMN     "seq" BIGINT;

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "auditRetentionDays" INTEGER;

-- CreateTable
CREATE TABLE "AuditStream" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "AuditStreamKind" NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "cursorSeq" BIGINT NOT NULL DEFAULT 0,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lastDeliveredAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditStream_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuditStream_companyId_key" ON "AuditStream"("companyId");

-- CreateIndex
CREATE INDEX "AuditStream_enabled_nextAttemptAt_idx" ON "AuditStream"("enabled", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityLog_companyId_seq_key" ON "ActivityLog"("companyId", "seq");

-- AddForeignKey
ALTER TABLE "AuditStream" ADD CONSTRAINT "AuditStream_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hash chain. Each company's entries form one chain: an entry's hash covers
-- its content and the previous entry's hash, so editing, removing or
-- reordering any entry breaks every link after it. The JSON array is the
-- canonical encoding: unambiguous field boundaries, and jsonb prints
-- metadata with its keys in a fixed order. The actor is left out on purpose:
-- deleting an account clears it (see "preserve_activity_on_user_delete"),
-- and that must not read as tampering. audit_log_guard protects it instead.
CREATE FUNCTION audit_entry_hash(
  prev_hash TEXT,
  company_id TEXT,
  seq BIGINT,
  created_at TIMESTAMP(3),
  action TEXT,
  entity_type TEXT,
  entity_id TEXT,
  summary TEXT,
  metadata JSONB
) RETURNS TEXT LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT encode(sha256(convert_to(jsonb_build_array(
    prev_hash, company_id, seq, to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    action, entity_type, entity_id, summary, metadata
  )::text, 'UTF8')), 'hex')
$$;

-- Existing entries are chained in the order they were written. The ALTER
-- TABLE above holds the table's lock until this migration commits, so no
-- entry can be inserted in between and miss the chain.
DO $$
DECLARE
  entry RECORD;
  chain_company TEXT := NULL;
  chain_seq BIGINT := 0;
  chain_hash TEXT := NULL;
  entry_hash TEXT;
BEGIN
  FOR entry IN SELECT * FROM "ActivityLog" ORDER BY "companyId", "createdAt", "id" LOOP
    IF chain_company IS DISTINCT FROM entry."companyId" THEN
      chain_company := entry."companyId";
      chain_seq := 0;
      chain_hash := NULL;
    END IF;
    chain_seq := chain_seq + 1;
    entry_hash := audit_entry_hash(chain_hash, entry."companyId", chain_seq, entry."createdAt",
      entry."action", entry."entityType", entry."entityId", entry."summary", entry."metadata");
    UPDATE "ActivityLog" SET "seq" = chain_seq, "prevHash" = chain_hash, "hash" = entry_hash
      WHERE "id" = entry."id";
    chain_hash := entry_hash;
  END LOOP;
END
$$;

-- Sealing runs as the inserting transaction commits (a deferred constraint
-- trigger), so seq follows commit order: a reader that sees entry n has
-- already been able to see every entry before it, which is what lets an
-- audit stream resume from a single cursor. The per-company lock is held
-- only from here to the commit, and taken after every other lock the
-- transaction holds, so it can't deadlock with them. SECURITY DEFINER
-- because a tenant transaction may insert entries but not update them.
CREATE FUNCTION audit_seal() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  head_seq BIGINT;
  head_hash TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('resumerank:audit:' || NEW."companyId", 0));
  SELECT "seq", "hash" INTO head_seq, head_hash FROM "ActivityLog"
    WHERE "companyId" = NEW."companyId" AND "seq" IS NOT NULL
    ORDER BY "seq" DESC
    LIMIT 1;
  head_seq := COALESCE(head_seq, 0) + 1;

  PERFORM set_config('app.audit_sealing', 'on', true);
  UPDATE "ActivityLog"
    SET "seq" = head_seq,
        "prevHash" = head_hash,
        "hash" = audit_entry_hash(head_hash, NEW."companyId", head_seq, NEW."createdAt",
          NEW."action", NEW."entityType", NEW."entityId", NEW."summary", NEW."metadata")
    WHERE "id" = NEW."id" AND "seq" IS NULL;
  PERFORM set_config('app.audit_sealing', '', true);
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER audit_seal
  AFTER INSERT ON "ActivityLog"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION audit_seal();

-- Append-only for every role, the owner included. The only changes allowed:
-- sealing a new entry once, clearing the actor of a deleted account, and
-- deleting entries when their company is deleted (a cascade, so one trigger
-- level down) or by the retention purge, which sets app.audit_purge.
CREATE FUNCTION audit_log_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'The audit log cannot be truncated.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() > 1 OR current_setting('app.audit_purge', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Audit log entries cannot be deleted.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF (NEW."id", NEW."companyId", NEW."createdAt", NEW."action", NEW."entityType",
      NEW."entityId", NEW."summary", NEW."metadata")
     IS NOT DISTINCT FROM
     (OLD."id", OLD."companyId", OLD."createdAt", OLD."action", OLD."entityType",
      OLD."entityId", OLD."summary", OLD."metadata")
  THEN
    IF current_setting('app.audit_sealing', true) = 'on'
       AND OLD."seq" IS NULL
       AND NEW."actorId" IS NOT DISTINCT FROM OLD."actorId" THEN
      RETURN NEW;
    END IF;
    IF NEW."actorId" IS NULL
       AND (NEW."seq", NEW."prevHash", NEW."hash") IS NOT DISTINCT FROM (OLD."seq", OLD."prevHash", OLD."hash") THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'Audit log entries cannot be changed.' USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER audit_log_guard_row
  BEFORE UPDATE OR DELETE ON "ActivityLog"
  FOR EACH ROW EXECUTE FUNCTION audit_log_guard();

CREATE TRIGGER audit_log_guard_truncate
  BEFORE TRUNCATE ON "ActivityLog"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_guard();

-- Stream settings are managed in tenant transactions (services/audit.ts);
-- delivery runs across tenants on the owner connection.
GRANT SELECT, INSERT, UPDATE, DELETE ON "AuditStream" TO resumerank_tenant;

ALTER TABLE "AuditStream" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AuditStream" TO resumerank_tenant
  USING ("companyId" = current_setting('app.company_id', true));
