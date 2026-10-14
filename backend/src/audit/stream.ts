import { db } from "../db";
import { env } from "../env";
import { companyHasFeature } from "../flags/evaluate";
import type { AuditStreamKind } from "../generated/prisma/enums";
import { errorFields, log } from "../observability/log";
import { open, seal, subkey } from "../sealed-box";
import { AUDIT_EVENT_SELECT, toAuditEvents } from "./events";
import { OutboundError, postOutbound, type OutboundRequest } from "./outbound";
import { buildStreamRequest, streamBackoffMs } from "./stream-format";

const KEY_INFO = "resumerank:audit-stream:v1";

let cachedKey: { secret: string; key: Buffer } | null = null;

function key(): Buffer {
  const secret = env().AUTH_SECRET;
  if (cachedKey?.secret !== secret) cachedKey = { secret, key: subkey(secret, KEY_INFO) };
  return cachedKey.key;
}

/**
 * The destination is bound in as associated data: a secret copied onto
 * another company's row, or a row whose URL was edited to point somewhere
 * else, fails to open instead of handing the token to the new address.
 */
function associatedData(companyId: string, kind: AuditStreamKind, url: string): string {
  return `${companyId}\n${kind}\n${url}`;
}

export interface StreamDestination {
  companyId: string;
  kind: AuditStreamKind;
  url: string;
}

export function sealStreamSecret(secret: string, destination: StreamDestination): string {
  return seal(secret, associatedData(destination.companyId, destination.kind, destination.url), key());
}

export function openStreamSecret(sealed: string, destination: StreamDestination): string | null {
  return open(sealed, associatedData(destination.companyId, destination.kind, destination.url), key());
}

export type SendStreamRequest = (url: string, request: OutboundRequest) => Promise<void>;

/** Entries per delivery; a stream that is further behind catches up over several. */
export const STREAM_BATCH_SIZE = 500;
const STALE_LOCK_MS = 2 * 60 * 1000;
const MAX_ERROR_LENGTH = 500;

interface ClaimedStream {
  id: string;
  companyId: string;
  kind: AuditStreamKind;
  url: string;
  secret: string;
  cursorSeq: bigint;
  failures: number;
  lockedAt: Date;
}

/**
 * `SKIP LOCKED` lets overlapping drains share the work without delivering a
 * batch twice; a claim abandoned by a crashed worker expires after a while.
 */
async function claimNextStream(now: Date, exclude: readonly string[]): Promise<ClaimedStream | null> {
  const staleBefore = new Date(now.getTime() - STALE_LOCK_MS);
  const [claimed] = await db.$queryRaw<ClaimedStream[]>`
    UPDATE "AuditStream" SET "lockedAt" = ${now}
    WHERE "id" = (
      SELECT "id" FROM "AuditStream"
      WHERE "enabled" AND "nextAttemptAt" <= ${now}
        AND ("lockedAt" IS NULL OR "lockedAt" < ${staleBefore})
        AND NOT ("id" = ANY(${exclude}::text[]))
      ORDER BY "nextAttemptAt", "id"
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id", "companyId", "kind", "url", "secret", "cursorSeq", "failures", "lockedAt"
  `;
  return claimed ?? null;
}

/** Only the current claim may settle a stream; a reclaimed one belongs to its new worker. */
function ownedBy(stream: ClaimedStream) {
  return { id: stream.id, lockedAt: stream.lockedAt };
}

async function recordFailure(stream: ClaimedStream, message: string, now: Date): Promise<void> {
  const failures = stream.failures + 1;
  await db.auditStream.updateMany({
    where: ownedBy(stream),
    data: {
      failures,
      lastError: message.slice(0, MAX_ERROR_LENGTH),
      nextAttemptAt: new Date(now.getTime() + streamBackoffMs(failures)),
      lockedAt: null,
    },
  });
}

interface BatchOutcome {
  delivered: number;
  /** More entries are waiting behind this batch. */
  more: boolean;
}

const NOTHING_DELIVERED: BatchOutcome = { delivered: 0, more: false };

const NOT_ENTITLED_RECHECK_MS = 60 * 60 * 1000;
export const STREAM_NOT_ENTITLED = "Audit log streaming isn't enabled for this workspace. Delivery resumes from here once it is.";

/**
 * A company that loses streaming keeps its stream and cursor: nothing is
 * sent meanwhile, and when the feature comes back delivery picks up every
 * entry written in between. It isn't a delivery failure, so no backoff.
 */
async function holdUnentitled(stream: ClaimedStream, now: Date): Promise<void> {
  await db.auditStream.updateMany({
    where: ownedBy(stream),
    data: {
      lastError: STREAM_NOT_ENTITLED,
      nextAttemptAt: new Date(now.getTime() + NOT_ENTITLED_RECHECK_MS),
      lockedAt: null,
    },
  });
}

async function deliverBatch(stream: ClaimedStream, send: SendStreamRequest, now: Date): Promise<BatchOutcome> {
  if (!(await companyHasFeature(stream.companyId, "audit-streaming"))) {
    await holdUnentitled(stream, now);
    return NOTHING_DELIVERED;
  }

  const secret = openStreamSecret(stream.secret, stream);
  if (secret === null) {
    log.error("audit_stream.secret_unreadable", { companyId: stream.companyId });
    await recordFailure(stream, "The stored token can't be decrypted (AUTH_SECRET may have changed). Save the stream again.", now);
    return NOTHING_DELIVERED;
  }

  const rows = await db.activityLog.findMany({
    where: { companyId: stream.companyId, seq: { gt: stream.cursorSeq } },
    orderBy: { seq: "asc" },
    take: STREAM_BATCH_SIZE,
    select: AUDIT_EVENT_SELECT,
  });
  const events = toAuditEvents(rows);
  const last = events.at(-1);
  if (!last) {
    await db.auditStream.updateMany({ where: ownedBy(stream), data: { lockedAt: null } });
    return NOTHING_DELIVERED;
  }

  try {
    await send(stream.url, buildStreamRequest(stream.kind, secret, events, now));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordFailure(stream, message, now);
    log.warn("audit_stream.delivery_failed", {
      companyId: stream.companyId,
      kind: stream.kind,
      failures: stream.failures + 1,
      status: error instanceof OutboundError ? error.status : null,
      ...errorFields(error),
    });
    return NOTHING_DELIVERED;
  }

  await db.auditStream.updateMany({
    where: ownedBy(stream),
    data: {
      cursorSeq: BigInt(last.seq),
      failures: 0,
      lastError: null,
      lastDeliveredAt: now,
      nextAttemptAt: now,
      lockedAt: null,
    },
  });
  log.info("audit_stream.delivered", { companyId: stream.companyId, kind: stream.kind, events: events.length });
  return { delivered: events.length, more: rows.length === STREAM_BATCH_SIZE };
}

export interface StreamDrainOptions {
  budgetMs?: number;
  send?: SendStreamRequest;
}

const DEFAULT_DRAIN_BUDGET_MS = 20_000;

/**
 * Delivers every due stream's backlog until done or out of time. Delivery is
 * at least once: a crash after the SIEM accepted a batch but before the
 * cursor moved re-sends it, so receivers should dedupe on `id` (or `seq`).
 */
export async function drainAuditStreams(options: StreamDrainOptions = {}): Promise<{ delivered: number }> {
  const { budgetMs = DEFAULT_DRAIN_BUDGET_MS, send = postOutbound } = options;
  const deadline = Date.now() + budgetMs;
  // Streams done for this drain: caught up, or failed and backing off.
  const settled: string[] = [];
  let delivered = 0;

  while (Date.now() < deadline) {
    const now = new Date();
    const stream = await claimNextStream(now, settled);
    if (!stream) break;
    const outcome = await deliverBatch(stream, send, now);
    delivered += outcome.delivered;
    if (!outcome.more) settled.push(stream.id);
  }
  return { delivered };
}
