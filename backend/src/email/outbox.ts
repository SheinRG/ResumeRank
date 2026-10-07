import { randomUUID } from "node:crypto";

import type { WebhookEventPayload } from "resend";

import { db } from "../db";
import { env } from "../env";
import type { Prisma } from "../generated/prisma/client";
import type { EmailKind, EmailStatus } from "../generated/prisma/enums";
import { errorFields, log, withLogContext } from "../observability/log";
import { EMAIL_RETENTION_MS, STALE_SEND_MS, MAX_EMAIL_ATTEMPTS, decideRetry } from "./policy";
import { openEmail, outboxKey, sealEmail } from "./sealed";
import { DeliveryError, deliverEmail, type Deliver, type OutgoingEmail } from "./transport";

export interface QueuedEmail extends OutgoingEmail {
  kind: EmailKind;
  /** When the link inside stops working. */
  expiresAt: Date;
}

/** Only the delegate enqueueing needs, so a transaction client (tenant or not) fits. */
export interface OutboxWriter {
  emailMessage: {
    createMany(args: Prisma.EmailMessageCreateManyArgs): PromiseLike<Prisma.BatchPayload>;
  };
}

let cachedKey: { secret: string; key: Buffer } | null = null;

function key(): Buffer {
  const secret = env().AUTH_SECRET;
  if (cachedKey?.secret !== secret) cachedKey = { secret, key: outboxKey(secret) };
  return cachedKey.key;
}

/**
 * Queues a message in the caller's transaction, so it exists if and only if
 * the token or invite it carries does. `createMany` because it writes without
 * `RETURNING`: tenant transactions may insert here but not read the table.
 */
export async function enqueueEmail(email: QueuedEmail, client: OutboxWriter = db): Promise<string> {
  const id = randomUUID();
  const { kind, to, expiresAt, subject, html, actionUrl } = email;
  await client.emailMessage.createMany({
    data: [{ id, kind, to, expiresAt, payload: sealEmail({ subject, html, actionUrl }, id, to, key()) }],
  });
  return id;
}

interface ClaimedEmail {
  id: string;
  kind: EmailKind;
  to: string;
  payload: string | null;
  attempts: number;
  lockedAt: Date;
  expiresAt: Date;
}

/** `SKIP LOCKED` lets any number of drains run at once without double-sending. */
export async function claimNextEmail(now = new Date()): Promise<ClaimedEmail | null> {
  const [claimed] = await db.$queryRaw<ClaimedEmail[]>`
    UPDATE "EmailMessage"
    SET "status" = 'SENDING', "lockedAt" = ${now}, "attempts" = "attempts" + 1, "updatedAt" = ${now}
    WHERE "id" = (
      SELECT "id" FROM "EmailMessage"
      WHERE "status" = 'QUEUED' AND "nextAttemptAt" <= ${now}
      ORDER BY "nextAttemptAt", "id"
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id", "kind", "to", "payload", "attempts", "lockedAt", "expiresAt"
  `;
  return claimed ?? null;
}

/**
 * A worker killed mid-send leaves its row SENDING. It goes back to the queue
 * (Resend's idempotency key makes a re-send of an accepted message a no-op),
 * or fails once out of attempts.
 */
export async function recoverStaleEmails(now = new Date()): Promise<number> {
  const staleBefore = new Date(now.getTime() - STALE_SEND_MS);
  const [requeued, failed] = await db.$transaction([
    db.emailMessage.updateMany({
      where: { status: "SENDING", lockedAt: { lt: staleBefore }, attempts: { lt: MAX_EMAIL_ATTEMPTS } },
      data: { status: "QUEUED", lockedAt: null, nextAttemptAt: now },
    }),
    db.emailMessage.updateMany({
      where: { status: "SENDING", lockedAt: { lt: staleBefore }, attempts: { gte: MAX_EMAIL_ATTEMPTS } },
      data: { status: "FAILED", lockedAt: null, payload: null, error: "The sender stopped before delivery finished." },
    }),
  ]);
  const recovered = requeued.count + failed.count;
  if (recovered > 0) log.warn("email.stale_sends", { requeued: requeued.count, failed: failed.count });
  return recovered;
}

async function pruneEmails(now: Date): Promise<void> {
  await db.emailMessage.deleteMany({
    where: {
      createdAt: { lt: new Date(now.getTime() - EMAIL_RETENTION_MS) },
      status: { notIn: ["QUEUED", "SENDING"] },
    },
  });
}

/** Only the claim that is still current may settle a message; a recovered-and-reclaimed one belongs to its new worker. */
function ownedBy(message: ClaimedEmail) {
  return { id: message.id, status: "SENDING" as const, lockedAt: message.lockedAt };
}

/** Terminal statuses drop the payload: the raw token inside has no reason to outlive delivery. */
async function settle(
  message: ClaimedEmail,
  status: EmailStatus,
  data: Omit<Prisma.EmailMessageUpdateManyMutationInput, "status" | "payload" | "lockedAt"> = {},
): Promise<void> {
  await db.emailMessage.updateMany({
    where: ownedBy(message),
    data: { ...data, status, payload: null, lockedAt: null },
  });
}

async function isSuppressed(address: string): Promise<boolean> {
  const row = await db.emailSuppression.findUnique({
    where: { email: address.toLowerCase() },
    select: { email: true },
  });
  return row !== null;
}

async function processEmail(message: ClaimedEmail, deliver: Deliver): Promise<void> {
  if (message.expiresAt <= new Date()) {
    await settle(message, "EXPIRED", { error: "The link expired before the message could be delivered." });
    log.warn("email.expired", { kind: message.kind });
    return;
  }
  if (await isSuppressed(message.to)) {
    await settle(message, "SUPPRESSED", { error: "This address bounced or reported spam earlier." });
    log.info("email.suppressed", { kind: message.kind });
    return;
  }
  const content = message.payload ? openEmail(message.payload, message.id, message.to, key()) : null;
  if (!content) {
    await settle(message, "FAILED", {
      error: "The message could not be decrypted; AUTH_SECRET may have changed since it was queued.",
    });
    log.error("email.unreadable", { kind: message.kind });
    return;
  }

  try {
    const receipt = await deliver({ to: message.to, ...content }, `email-outbox/${message.id}`);
    await settle(message, "SENT", {
      error: null,
      sentAt: new Date(),
      provider: receipt.provider,
      providerMessageId: receipt.messageId,
    });
    log.info("email.sent", { kind: message.kind, provider: receipt.provider, attempts: message.attempts });
  } catch (error) {
    // Unknown failures are retried: a bug that throws is better paused by
    // backoff than turned into a lost email.
    const retryable = error instanceof DeliveryError ? error.retryable : true;
    const reason = error instanceof Error ? error.message : String(error);
    const decision = decideRetry({
      retryable,
      attempts: message.attempts,
      expiresAt: message.expiresAt,
      now: new Date(),
    });
    if (decision.retry) {
      await db.emailMessage.updateMany({
        where: ownedBy(message),
        data: { status: "QUEUED", lockedAt: null, nextAttemptAt: decision.nextAttemptAt, error: reason },
      });
      log.warn("email.retry", { kind: message.kind, attempts: message.attempts, ...errorFields(error) });
      return;
    }
    await settle(message, "FAILED", { error: reason });
    log.error("email.failed", { kind: message.kind, attempts: message.attempts, giveUp: decision.reason, ...errorFields(error) });
  }
}

export interface EmailDrainOptions {
  budgetMs?: number;
  lanes?: number;
  deliver?: Deliver;
}

const DEFAULT_DRAIN_BUDGET_MS = 10_000;
const DEFAULT_LANES = 2;

/**
 * Sends due messages until the queue is empty or the time budget is spent.
 * Safe to call from anywhere and as often as wanted — after an enqueue, from
 * a cron — because claiming is atomic.
 */
export async function drainEmailOutbox(options: EmailDrainOptions = {}): Promise<{ processed: number }> {
  const { budgetMs = DEFAULT_DRAIN_BUDGET_MS, lanes = DEFAULT_LANES, deliver = deliverEmail } = options;
  const deadline = Date.now() + budgetMs;

  return withLogContext({ worker: "email" }, async () => {
    const now = new Date();
    await recoverStaleEmails(now);
    await pruneEmails(now);
    let processed = 0;

    async function lane(): Promise<void> {
      while (Date.now() < deadline) {
        const message = await claimNextEmail();
        if (!message) return;
        await withLogContext({ emailId: message.id }, async () => {
          try {
            await processEmail(message, deliver);
          } catch (error) {
            log.error("email.process_crashed", errorFields(error));
          }
        });
        processed += 1;
      }
    }

    await Promise.all(Array.from({ length: lanes }, lane));
    return { processed };
  });
}

async function suppress(addresses: string[], reason: "bounce" | "complaint"): Promise<void> {
  await db.emailSuppression.createMany({
    data: addresses.map((address) => ({ email: address.toLowerCase(), reason })),
    skipDuplicates: true,
  });
}

/**
 * Applies a verified provider event. Only hard bounces and complaints
 * suppress the address — mailing either again hurts the sending domain's
 * reputation — while a transient bounce just records what happened.
 */
export async function applyEmailEvent(event: WebhookEventPayload): Promise<void> {
  switch (event.type) {
    case "email.delivered": {
      await db.emailMessage.updateMany({
        where: { providerMessageId: event.data.email_id },
        data: { deliveredAt: new Date(event.created_at) },
      });
      return;
    }
    case "email.bounced": {
      const { type, subType, message } = event.data.bounce;
      if (type === "Permanent") await suppress(event.data.to, "bounce");
      await db.emailMessage.updateMany({
        where: { providerMessageId: event.data.email_id },
        data: { status: "BOUNCED", error: `Bounced (${type}/${subType}): ${message}`.slice(0, 500) },
      });
      log.warn("email.bounced", { bounceType: type, bounceSubType: subType });
      return;
    }
    case "email.complained": {
      await suppress(event.data.to, "complaint");
      await db.emailMessage.updateMany({
        where: { providerMessageId: event.data.email_id },
        data: { status: "COMPLAINED", error: "The recipient reported this message as spam." },
      });
      log.warn("email.complained", {});
      return;
    }
    default:
      return;
  }
}
