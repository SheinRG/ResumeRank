import { tenantDb, tenantTransaction, type TenantTx } from "../tenant-db";
import { logActivity } from "../activity";
import { findChainBreak, type ChainBreak, type ChainEntry, type ChainLink } from "../audit/chain";
import {
  AUDIT_CSV_HEADER,
  AUDIT_EVENT_SELECT,
  auditCsvRow,
  auditJsonLine,
  toAuditEvents,
  type AuditEvent,
} from "../audit/events";
import { assertPublicHttpsUrl, OutboundError, postOutbound } from "../audit/outbound";
import { openStreamSecret, sealStreamSecret, type SendStreamRequest } from "../audit/stream";
import { buildStreamRequest, generateSigningSecret } from "../audit/stream-format";
import { csvRow } from "../csv";
import type { Prisma } from "../generated/prisma/client";
import type { AuditStreamKind } from "../generated/prisma/enums";
import { rateLimit, retryMessage, type RateLimit } from "../rate-limit";
import type {
  AuditExportParams,
  AuditRetentionInput,
  AuditStreamEnabledInput,
  AuditStreamInput,
} from "../validators/audit";
import { assertCanAdmin, type TenantContext } from "./context";
import { DomainError, ForbiddenError, NotFoundError } from "./errors";

export interface AuditStreamSummary {
  kind: AuditStreamKind;
  url: string;
  enabled: boolean;
  /** Entries written since the last one delivered. */
  pending: number;
  failures: number;
  lastError: string | null;
  lastDeliveredAt: Date | null;
  nextAttemptAt: Date;
  createdAt: Date;
}

export interface AuditSettings {
  retentionDays: number | null;
  /** The newest entry's position in the chain; null before the first entry. */
  latestSeq: number | null;
  stream: AuditStreamSummary | null;
}

export interface SavedAuditStream {
  stream: AuditStreamSummary;
  /** A new webhook's signing secret, shown once; null otherwise. */
  signingSecret: string | null;
}

export interface AuditChainReport {
  checked: number;
  firstSeq: number | null;
  lastSeq: number | null;
  fault: ChainBreak | null;
  checkedAt: Date;
}

export interface AuditExport {
  rowCount: number;
  stream: ReadableStream<Uint8Array>;
}

const STREAM_KIND_LABELS: Record<AuditStreamKind, string> = {
  WEBHOOK: "a webhook",
  SPLUNK: "Splunk",
  DATADOG: "Datadog",
};

const STREAM_SELECT = {
  kind: true,
  url: true,
  enabled: true,
  cursorSeq: true,
  failures: true,
  lastError: true,
  lastDeliveredAt: true,
  nextAttemptAt: true,
  createdAt: true,
} as const satisfies Prisma.AuditStreamSelect;

type StreamRow = Prisma.AuditStreamGetPayload<{ select: typeof STREAM_SELECT }>;

/** A handful per company, so the test button can't be used to hammer someone else's endpoint. */
const STREAM_TEST_LIMIT: RateLimit = { max: 5, windowMs: 5 * 60 * 1000 };
const EXPORT_BATCH = 1_000;
// The frontend compiles this package for a target without bigint literals.
const ZERO = BigInt(0);
const VERIFY_BATCH = 2_000;

function assertOwner(ctx: TenantContext, message: string): void {
  assertCanAdmin(ctx);
  if (ctx.role !== "OWNER") throw new ForbiddenError(message);
}

function toStreamSummary(row: StreamRow, latestSeq: bigint | null): AuditStreamSummary {
  const behind = latestSeq === null ? ZERO : latestSeq - row.cursorSeq;
  return {
    kind: row.kind,
    url: row.url,
    enabled: row.enabled,
    pending: behind > ZERO ? Number(behind) : 0,
    failures: row.failures,
    lastError: row.lastError,
    lastDeliveredAt: row.lastDeliveredAt,
    nextAttemptAt: row.nextAttemptAt,
    createdAt: row.createdAt,
  };
}

/** Either client: a single statement (tenantDb) or a tenant transaction. */
type LatestSeqReader = Pick<TenantTx, "activityLog">;

async function latestSeq(client: LatestSeqReader, companyId: string): Promise<bigint | null> {
  const latest = await client.activityLog.findFirst({
    where: { companyId, seq: { not: null } },
    orderBy: { seq: "desc" },
    select: { seq: true },
  });
  return latest?.seq ?? null;
}

export async function getAuditSettings(ctx: TenantContext): Promise<AuditSettings> {
  assertCanAdmin(ctx);
  const scoped = tenantDb(ctx);
  const [company, stream, latest] = await Promise.all([
    scoped.company.findUnique({ where: { id: ctx.companyId }, select: { auditRetentionDays: true } }),
    scoped.auditStream.findUnique({ where: { companyId: ctx.companyId }, select: STREAM_SELECT }),
    latestSeq(scoped, ctx.companyId),
  ]);
  if (!company) throw new NotFoundError("Your company no longer exists.");
  return {
    retentionDays: company.auditRetentionDays,
    latestSeq: latest === null ? null : Number(latest),
    stream: stream ? toStreamSummary(stream, latest) : null,
  };
}

function describeRetention(days: number | null): string {
  if (days === null) return "forever";
  if (days % 365 === 0) return `${days / 365} year${days === 365 ? "" : "s"}`;
  return `${days} days`;
}

/** Takes effect on the next purge (the audit cron), not at once: shortening it is reversible until then. */
export async function setAuditRetention(
  ctx: TenantContext,
  input: AuditRetentionInput,
): Promise<{ retentionDays: number | null }> {
  assertOwner(ctx, "Only an owner can change how long the audit log is kept.");

  return tenantTransaction(ctx, async (tx) => {
    const company = await tx.company.update({
      where: { id: ctx.companyId },
      data: { auditRetentionDays: input.retentionDays },
      select: { auditRetentionDays: true },
    });
    await logActivity(
      {
        companyId: ctx.companyId,
        actorId: ctx.actorId,
        action: "audit.retention",
        entityType: "company",
        entityId: ctx.companyId,
        summary: `set the audit log to be kept ${describeRetention(input.retentionDays)}`,
        metadata: { retentionDays: input.retentionDays },
      },
      tx,
    );
    return { retentionDays: company.auditRetentionDays };
  });
}

async function checkDestination(url: string): Promise<void> {
  try {
    await assertPublicHttpsUrl(url);
  } catch (error) {
    if (error instanceof OutboundError) throw new DomainError(error.message, { url: [error.message] });
    throw error;
  }
}

/**
 * Connects the company's audit stream, or changes where it goes. A new
 * stream starts from the newest entry (the export covers history); a changed
 * one keeps its place, so fixing a broken destination loses nothing.
 */
export async function saveAuditStream(ctx: TenantContext, input: AuditStreamInput): Promise<SavedAuditStream> {
  assertOwner(ctx, "Only an owner can send the audit log outside ResumeRank.");
  await checkDestination(input.url);
  const destination = { companyId: ctx.companyId, kind: input.kind, url: input.url };

  return tenantTransaction(ctx, async (tx) => {
    const existing = await tx.auditStream.findUnique({
      where: { companyId: ctx.companyId },
      select: { kind: true, url: true, secret: true },
    });
    const kept =
      existing?.kind === input.kind
        ? openStreamSecret(existing.secret, { companyId: ctx.companyId, kind: existing.kind, url: existing.url })
        : null;

    let secret: string;
    let signingSecret: string | null = null;
    if (input.kind === "WEBHOOK") {
      secret = kept ?? generateSigningSecret();
      if (kept === null) signingSecret = secret;
    } else if (input.token) {
      secret = input.token;
    } else if (kept !== null) {
      secret = kept;
    } else {
      const field = input.kind === "SPLUNK" ? "HEC token" : "API key";
      throw new DomainError(`Enter the ${field}.`, { token: [`Enter the ${field}`] });
    }

    const sealed = sealStreamSecret(secret, destination);
    const latest = await latestSeq(tx, ctx.companyId);
    const row = await tx.auditStream.upsert({
      where: { companyId: ctx.companyId },
      create: {
        companyId: ctx.companyId,
        kind: input.kind,
        url: input.url,
        secret: sealed,
        cursorSeq: latest ?? ZERO,
      },
      update: {
        kind: input.kind,
        url: input.url,
        secret: sealed,
        enabled: true,
        failures: 0,
        lastError: null,
        nextAttemptAt: new Date(),
        lockedAt: null,
      },
      select: STREAM_SELECT,
    });

    const host = new URL(input.url).host;
    await logActivity(
      {
        companyId: ctx.companyId,
        actorId: ctx.actorId,
        action: "audit.stream_save",
        entityType: "company",
        entityId: ctx.companyId,
        summary: `${existing ? "changed" : "connected"} audit log streaming to ${STREAM_KIND_LABELS[input.kind]} at ${host}`,
        metadata: { kind: input.kind, host, newSecret: signingSecret !== null },
      },
      tx,
    );
    return { stream: toStreamSummary(row, latest), signingSecret };
  });
}

/** Pausing holds the stream's place; resuming delivers everything written meanwhile. */
export async function setAuditStreamEnabled(
  ctx: TenantContext,
  input: AuditStreamEnabledInput,
): Promise<AuditStreamSummary> {
  assertOwner(ctx, "Only an owner can pause or resume audit streaming.");

  return tenantTransaction(ctx, async (tx) => {
    const { count } = await tx.auditStream.updateMany({
      where: { companyId: ctx.companyId },
      data: input.enabled
        ? { enabled: true, failures: 0, nextAttemptAt: new Date(), lockedAt: null }
        : { enabled: false },
    });
    if (count === 0) throw new NotFoundError("Audit streaming isn't set up.");
    const row = await tx.auditStream.findUniqueOrThrow({
      where: { companyId: ctx.companyId },
      select: STREAM_SELECT,
    });
    await logActivity(
      {
        companyId: ctx.companyId,
        actorId: ctx.actorId,
        action: input.enabled ? "audit.stream_resume" : "audit.stream_pause",
        entityType: "company",
        entityId: ctx.companyId,
        summary: `${input.enabled ? "resumed" : "paused"} audit log streaming`,
        metadata: { kind: row.kind },
      },
      tx,
    );
    return toStreamSummary(row, await latestSeq(tx, ctx.companyId));
  });
}

export async function removeAuditStream(ctx: TenantContext): Promise<{ kind: AuditStreamKind }> {
  assertOwner(ctx, "Only an owner can disconnect audit streaming.");

  return tenantTransaction(ctx, async (tx) => {
    const existing = await tx.auditStream.findUnique({
      where: { companyId: ctx.companyId },
      select: { kind: true, url: true },
    });
    if (!existing) throw new NotFoundError("Audit streaming isn't set up.");
    await tx.auditStream.delete({ where: { companyId: ctx.companyId } });
    await logActivity(
      {
        companyId: ctx.companyId,
        actorId: ctx.actorId,
        action: "audit.stream_remove",
        entityType: "company",
        entityId: ctx.companyId,
        summary: `disconnected audit log streaming to ${STREAM_KIND_LABELS[existing.kind]}`,
        metadata: { kind: existing.kind, host: new URL(existing.url).host },
      },
      tx,
    );
    return { kind: existing.kind };
  });
}

/**
 * Sends one marked test event straight away, so a misconfigured destination
 * shows up now rather than as a failure on the next delivery. It isn't part
 * of the chain: its seq is 0 and it carries no hash.
 */
export async function testAuditStream(
  ctx: TenantContext,
  send: SendStreamRequest = postOutbound,
): Promise<{ sentAt: Date }> {
  assertOwner(ctx, "Only an owner can test audit streaming.");
  const limited = await rateLimit(`audit-stream-test:${ctx.companyId}`, STREAM_TEST_LIMIT);
  if (!limited.allowed) {
    throw new DomainError(`Too many test events. Try again in ${retryMessage(limited.retryAfterSeconds)}.`);
  }

  const stream = await tenantDb(ctx).auditStream.findUnique({
    where: { companyId: ctx.companyId },
    select: { kind: true, url: true, secret: true },
  });
  if (!stream) throw new NotFoundError("Audit streaming isn't set up.");
  const secret = openStreamSecret(stream.secret, { companyId: ctx.companyId, kind: stream.kind, url: stream.url });
  if (secret === null) {
    throw new DomainError("The saved token can't be read any more. Save the stream again with a fresh one.");
  }

  const sentAt = new Date();
  const event: AuditEvent = {
    id: `test_${sentAt.getTime()}`,
    seq: 0,
    timestamp: sentAt.toISOString(),
    companyId: ctx.companyId,
    action: "audit.stream_test",
    entityType: "company",
    entityId: ctx.companyId,
    actorId: ctx.actorId,
    actorName: null,
    actorEmail: null,
    summary: "sent a test event to check audit log streaming",
    metadata: { test: true },
    prevHash: null,
    hash: "",
  };
  try {
    await send(stream.url, buildStreamRequest(stream.kind, secret, [event], sentAt));
  } catch (error) {
    if (error instanceof OutboundError) throw new DomainError(`The test event didn't arrive. ${error.message}`);
    throw error;
  }
  return { sentAt };
}

interface ChainRow {
  seq: bigint;
  prevHash: string | null;
  hash: string;
  expectedHash: string;
}

/**
 * Where the chain may begin when its oldest entries are gone: just after a
 * retention purge's recorded cut, and only there.
 */
async function purgeAnchor(ctx: TenantContext, first: ChainEntry): Promise<ChainLink | null> {
  if (first.prevHash === null) return null;
  const [purge] = await tenantDb(ctx).$queryRaw<{ found: number }[]>`
    SELECT 1 AS found FROM "ActivityLog"
    WHERE "companyId" = ${ctx.companyId}
      AND "action" = 'audit.purge'
      AND "metadata"->>'throughHash' = ${first.prevHash}
      AND ("metadata"->>'throughSeq')::bigint = ${first.seq - 1}
    LIMIT 1
  `;
  return purge ? { seq: first.seq - 1, hash: first.prevHash } : null;
}

/**
 * Recomputes every entry's hash and walks the links, oldest first. Stops at
 * the first fault: everything after a break is unverifiable anyway.
 */
export async function verifyAuditLog(ctx: TenantContext): Promise<AuditChainReport> {
  assertCanAdmin(ctx);
  let previous: ChainLink | null = null;
  let afterSeq = ZERO;
  let firstSeq: number | null = null;
  let checked = 0;

  for (;;) {
    // Raw SQL so the hash is recomputed by the same function that wrote it.
    const rows = await tenantDb(ctx).$queryRaw<ChainRow[]>`
      SELECT "seq", "prevHash", "hash",
        audit_entry_hash("prevHash", "companyId", "seq", "createdAt", "action",
          "entityType", "entityId", "summary", "metadata") AS "expectedHash"
      FROM "ActivityLog"
      WHERE "companyId" = ${ctx.companyId} AND "seq" > ${afterSeq}
      ORDER BY "seq"
      LIMIT ${VERIFY_BATCH}
    `;
    const entries: ChainEntry[] = rows.map((row) => ({ ...row, seq: Number(row.seq) }));
    const [first] = entries;
    if (!first) break;

    if (firstSeq === null) {
      firstSeq = first.seq;
      if (first.seq > 1) previous = await purgeAnchor(ctx, first);
    }
    const fault = findChainBreak(previous, entries);
    if (fault) {
      const intact = entries.filter((entry) => entry.seq < fault.seq);
      return {
        checked: checked + intact.length,
        firstSeq,
        lastSeq: intact.at(-1)?.seq ?? previous?.seq ?? null,
        fault,
        checkedAt: new Date(),
      };
    }

    checked += entries.length;
    const last = entries[entries.length - 1];
    previous = { seq: last.seq, hash: last.hash };
    afterSeq = BigInt(last.seq);
    if (entries.length < VERIFY_BATCH) break;
  }

  return { checked, firstSeq, lastSeq: previous?.seq ?? null, fault: null, checkedAt: new Date() };
}

function dateBounds(params: AuditExportParams): Prisma.DateTimeFilter | undefined {
  if (!params.from && !params.to) return undefined;
  const filter: Prisma.DateTimeFilter = {};
  if (params.from) filter.gte = new Date(`${params.from}T00:00:00.000Z`);
  if (params.to) filter.lt = new Date(new Date(`${params.to}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000);
  return filter;
}

/**
 * Streams the log as CSV or JSON Lines, oldest first, with each entry's
 * chain hashes so the copy can be checked against the original later. The
 * export is pinned to the entries that existed when it started, and is
 * itself audited before the first byte goes out.
 */
export async function exportAuditLog(ctx: TenantContext, params: AuditExportParams): Promise<AuditExport> {
  assertCanAdmin(ctx);
  const scoped = tenantDb(ctx);
  const throughSeq = (await latestSeq(scoped, ctx.companyId)) ?? ZERO;
  const createdAt = dateBounds(params);
  const where: Prisma.ActivityLogWhereInput = {
    companyId: ctx.companyId,
    seq: { lte: throughSeq },
    ...(createdAt ? { createdAt } : {}),
  };
  const rowCount = await scoped.activityLog.count({ where });

  await tenantTransaction(ctx, (tx) =>
    logActivity(
      {
        companyId: ctx.companyId,
        actorId: ctx.actorId,
        action: "audit.export",
        entityType: "company",
        entityId: ctx.companyId,
        summary: `exported ${rowCount} audit ${rowCount === 1 ? "entry" : "entries"} as ${params.format === "csv" ? "CSV" : "JSON Lines"}`,
        metadata: {
          format: params.format,
          from: params.from ?? null,
          to: params.to ?? null,
          rowCount,
          throughSeq: Number(throughSeq),
        },
      },
      tx,
    ),
  );

  const encoder = new TextEncoder();
  let afterSeq = ZERO;
  let headerSent = params.format !== "csv";

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!headerSent) {
        headerSent = true;
        controller.enqueue(encoder.encode(`${csvRow(AUDIT_CSV_HEADER)}\n`));
        return;
      }
      const rows = await scoped.activityLog.findMany({
        where: { AND: [where, { seq: { gt: afterSeq } }] },
        orderBy: { seq: "asc" },
        take: EXPORT_BATCH,
        select: AUDIT_EVENT_SELECT,
      });
      const events = toAuditEvents(rows);
      if (events.length > 0) {
        const lines = events.map(params.format === "csv" ? auditCsvRow : auditJsonLine);
        controller.enqueue(encoder.encode(`${lines.join("\n")}\n`));
      }
      const last = rows.at(-1);
      if (last?.seq) afterSeq = last.seq;
      if (rows.length < EXPORT_BATCH) controller.close();
    },
  });

  return { rowCount, stream };
}
