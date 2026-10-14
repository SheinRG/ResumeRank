import { db } from "../db";
import { OutboundError, postOutbound, type OutboundRequest } from "../audit/outbound";
import { streamBackoffMs } from "../audit/stream-format";
import type { Prisma } from "../generated/prisma/client";
import { errorFields, log } from "../observability/log";
import { buildWebhookRequest } from "./format";
import { openWebhookSecret } from "./outbox";

export type SendWebhookRequest = (url: string, request: OutboundRequest) => Promise<void>;

/** About four hours of retries (1, 2, 4 … minutes, capped at an hour) before giving up. */
export const MAX_WEBHOOK_ATTEMPTS = 10;
const STALE_LOCK_MS = 2 * 60 * 1000;
const MAX_ERROR_LENGTH = 500;
/** Delivered and failed rows are kept this long for the settings page, then purged. */
const KEEP_SETTLED_MS = 30 * 24 * 60 * 60 * 1000;

interface ClaimedDelivery {
  id: string;
  companyId: string;
  endpointId: string;
  event: string;
  payload: Prisma.JsonValue;
  attempts: number;
  lockedAt: Date;
  url: string;
  secret: string;
}

/**
 * `SKIP LOCKED` lets overlapping drains share the queue without sending a
 * delivery twice; a claim abandoned by a crashed worker expires. A paused
 * endpoint keeps its deliveries until it is resumed.
 */
async function claimNextDelivery(now: Date): Promise<ClaimedDelivery | null> {
  const staleBefore = new Date(now.getTime() - STALE_LOCK_MS);
  const [claimed] = await db.$queryRaw<ClaimedDelivery[]>`
    UPDATE "WebhookDelivery" AS d SET "lockedAt" = ${now}
    FROM "WebhookEndpoint" AS e
    WHERE e."id" = d."endpointId"
      AND d."id" = (
        SELECT q."id" FROM "WebhookDelivery" AS q
        JOIN "WebhookEndpoint" AS qe ON qe."id" = q."endpointId"
        WHERE q."status" = 'PENDING' AND q."nextAttemptAt" <= ${now} AND qe."enabled"
          AND (q."lockedAt" IS NULL OR q."lockedAt" < ${staleBefore})
        ORDER BY q."nextAttemptAt", q."id"
        LIMIT 1
        FOR UPDATE OF q SKIP LOCKED
      )
    RETURNING d."id", d."companyId", d."endpointId", d."event", d."payload", d."attempts", d."lockedAt",
      e."url", e."secret"
  `;
  return claimed ?? null;
}

/** Only the current claim may settle a delivery; a reclaimed one belongs to its new worker. */
function ownedBy(delivery: ClaimedDelivery) {
  return { id: delivery.id, lockedAt: delivery.lockedAt };
}

async function recordFailure(delivery: ClaimedDelivery, message: string, now: Date): Promise<void> {
  const attempts = delivery.attempts + 1;
  const lastError = message.slice(0, MAX_ERROR_LENGTH);
  const gaveUp = attempts >= MAX_WEBHOOK_ATTEMPTS;
  await db.$transaction([
    db.webhookDelivery.updateMany({
      where: ownedBy(delivery),
      data: gaveUp
        ? { attempts, lastError, lockedAt: null, status: "FAILED" }
        : { attempts, lastError, lockedAt: null, nextAttemptAt: new Date(now.getTime() + streamBackoffMs(attempts)) },
    }),
    db.webhookEndpoint.updateMany({
      where: { id: delivery.endpointId, companyId: delivery.companyId },
      data: { lastError },
    }),
  ]);
  log.warn("webhook.delivery_failed", {
    companyId: delivery.companyId,
    endpointId: delivery.endpointId,
    event: delivery.event,
    attempts,
    gaveUp,
  });
}

async function deliver(delivery: ClaimedDelivery, send: SendWebhookRequest, now: Date): Promise<boolean> {
  const secret = openWebhookSecret(delivery.secret, delivery.companyId, delivery.url);
  if (secret === null) {
    log.error("webhook.secret_unreadable", { companyId: delivery.companyId, endpointId: delivery.endpointId });
    await recordFailure(
      delivery,
      "The signing secret can't be decrypted (AUTH_SECRET may have changed). Recreate the endpoint.",
      now,
    );
    return false;
  }

  try {
    await send(delivery.url, buildWebhookRequest(delivery, secret, now));
  } catch (error) {
    if (!(error instanceof OutboundError)) log.error("webhook.send_crashed", errorFields(error));
    await recordFailure(delivery, error instanceof Error ? error.message : String(error), now);
    return false;
  }

  await db.$transaction([
    db.webhookDelivery.updateMany({
      where: ownedBy(delivery),
      data: { status: "DELIVERED", attempts: delivery.attempts + 1, deliveredAt: now, lastError: null, lockedAt: null },
    }),
    db.webhookEndpoint.updateMany({
      where: { id: delivery.endpointId, companyId: delivery.companyId },
      data: { lastDeliveredAt: now, lastError: null },
    }),
  ]);
  return true;
}

export interface WebhookDrainOptions {
  budgetMs?: number;
  send?: SendWebhookRequest;
}

const DEFAULT_DRAIN_BUDGET_MS = 20_000;

/**
 * Sends due deliveries until the queue is empty or time runs out. At least
 * once and in no guaranteed order: a crash after the receiver answered but
 * before the row settled sends it again, so receivers dedupe on the payload `id`.
 */
export async function drainWebhooks(
  options: WebhookDrainOptions = {},
): Promise<{ delivered: number; failed: number }> {
  const { budgetMs = DEFAULT_DRAIN_BUDGET_MS, send = postOutbound } = options;
  const deadline = Date.now() + budgetMs;
  let delivered = 0;
  let failed = 0;

  while (Date.now() < deadline) {
    const now = new Date();
    const delivery = await claimNextDelivery(now);
    if (!delivery) break;
    if (await deliver(delivery, send, now)) delivered += 1;
    else failed += 1;
  }
  if (delivered + failed > 0) log.info("webhook.drained", { delivered, failed });
  return { delivered, failed };
}

/** Settled rows only: a pending delivery is never dropped, however old. */
export async function purgeSettledDeliveries(now = new Date()): Promise<number> {
  const { count } = await db.webhookDelivery.deleteMany({
    where: { status: { not: "PENDING" }, createdAt: { lt: new Date(now.getTime() - KEEP_SETTLED_MS) } },
  });
  return count;
}
