import { db } from "./db";
import { errorFields, log } from "./observability/log";

export interface RateLimit {
  max: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

interface WindowPosition {
  current: Date;
  previous: Date;
  /** How far into the current window `now` is, 0–1. */
  elapsed: number;
  endsAt: number;
}

function windowPosition(now: number, windowMs: number): WindowPosition {
  const start = Math.floor(now / windowMs) * windowMs;
  return {
    current: new Date(start),
    previous: new Date(start - windowMs),
    elapsed: (now - start) / windowMs,
    endsAt: start + windowMs,
  };
}

/**
 * Sliding-window estimate from two fixed windows: the previous window's count
 * weighted by how much of it still overlaps the last `windowMs`, plus the
 * current window. Avoids the fixed-window burst of 2× max at a boundary
 * without storing one row per request.
 */
export function slidingCount(previous: number, current: number, elapsed: number): number {
  return previous * (1 - elapsed) + current;
}

const PRUNE_PROBABILITY = 0.01;
const PRUNE_BATCH = 1_000;

/** Expired rows are swept opportunistically so the table needs no scheduled job. */
function maybePrune(now: number): void {
  if (Math.random() >= PRUNE_PROBABILITY) return;
  db.$executeRaw`
    DELETE FROM "RateLimitCounter"
    WHERE ctid IN (
      SELECT ctid FROM "RateLimitCounter"
      WHERE "expiresAt" < ${new Date(now)}::timestamp(3)
      LIMIT ${PRUNE_BATCH}
    )
  `.catch((error: unknown) => log.warn("rate_limit.prune_failed", errorFields(error)));
}

function retryAfter(position: WindowPosition, now: number): number {
  return Math.max(1, Math.ceil((position.endsAt - now) / 1000));
}

/**
 * Spends `cost` units from `key`'s budget if they fit, shared across every
 * app instance. The check and the increment are one statement — the
 * conflicting row is locked and the condition re-evaluated against its
 * latest value — so concurrent requests can't overshoot `max`. A request that
 * would overshoot is refused whole and spends nothing.
 */
export async function rateLimit(
  key: string,
  { max, windowMs }: RateLimit,
  cost = 1,
  now = Date.now(),
): Promise<RateLimitResult> {
  const position = windowPosition(now, windowMs);
  const weight = 1 - position.elapsed;
  const expiresAt = new Date(position.endsAt + windowMs);
  maybePrune(now);

  const rows = await db.$queryRaw<Array<{ count: number }>>`
    WITH previous AS (
      SELECT COALESCE(
        (SELECT "count" FROM "RateLimitCounter"
         WHERE "key" = ${key} AND "windowStart" = ${position.previous}::timestamp(3)),
        0
      ) AS "count"
    )
    INSERT INTO "RateLimitCounter" ("key", "windowStart", "count", "expiresAt")
    SELECT ${key}, ${position.current}::timestamp(3), ${cost}::int, ${expiresAt}::timestamp(3)
    FROM previous
    WHERE previous."count" * ${weight}::float8 + ${cost}::int <= ${max}::float8
    ON CONFLICT ("key", "windowStart") DO UPDATE
      SET "count" = "RateLimitCounter"."count" + EXCLUDED."count"
      WHERE (SELECT "count" FROM previous) * ${weight}::float8
            + "RateLimitCounter"."count" + EXCLUDED."count" <= ${max}::float8
    RETURNING "count"
  `;
  if (rows.length > 0) return { allowed: true, retryAfterSeconds: 0 };
  return { allowed: false, retryAfterSeconds: retryAfter(position, now) };
}

/** The sliding-window total for `key`, without spending anything. */
export async function usageInWindow(key: string, windowMs: number, now = Date.now()): Promise<number> {
  const position = windowPosition(now, windowMs);
  const rows = await db.rateLimitCounter.findMany({
    where: { key, windowStart: { in: [position.previous, position.current] } },
    select: { windowStart: true, count: true },
  });
  const countAt = (start: Date) =>
    rows.find((row) => row.windowStart.getTime() === start.getTime())?.count ?? 0;
  return slidingCount(countAt(position.previous), countAt(position.current), position.elapsed);
}

/** Would `cost` more units fit right now? Spends nothing. */
export async function peekRateLimit(
  key: string,
  { max, windowMs }: RateLimit,
  cost = 1,
  now = Date.now(),
): Promise<RateLimitResult> {
  const used = await usageInWindow(key, windowMs, now);
  if (used + cost <= max) return { allowed: true, retryAfterSeconds: 0 };
  return { allowed: false, retryAfterSeconds: retryAfter(windowPosition(now, windowMs), now) };
}

/** Adds to `key`'s count unconditionally — for usage that has already happened (tokens, failures). */
export async function recordUsage(
  key: string,
  windowMs: number,
  amount: number,
  now = Date.now(),
): Promise<void> {
  if (amount <= 0) return;
  const position = windowPosition(now, windowMs);
  const expiresAt = new Date(position.endsAt + windowMs);
  await db.$executeRaw`
    INSERT INTO "RateLimitCounter" ("key", "windowStart", "count", "expiresAt")
    VALUES (${key}, ${position.current}::timestamp(3), ${amount}::int, ${expiresAt}::timestamp(3))
    ON CONFLICT ("key", "windowStart") DO UPDATE
      SET "count" = "RateLimitCounter"."count" + EXCLUDED."count"
  `;
}

export async function clearRateLimit(key: string): Promise<void> {
  await db.rateLimitCounter.deleteMany({ where: { key } });
}

export const AUTH_LIMIT: RateLimit = { max: 5, windowMs: 15 * 60 * 1000 };

/**
 * Every AI call is a paid LLM request. The per-user window stops one person
 * (or a stuck script) from hammering it; the per-company window caps a whole
 * tenant's call rate. Generous enough for a recruiter scoring a full pipeline.
 */
export const AI_USER_LIMIT: RateLimit = { max: 30, windowMs: 10 * 60 * 1000 };
export const AI_COMPANY_LIMIT: RateLimit = { max: 300, windowMs: 60 * 60 * 1000 };

export function retryMessage(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/**
 * Returns an error message when the caller is over quota, otherwise null.
 * The user window counts requests (a bulk request is one click); the company
 * window counts the LLM calls a request will make, since that is the spend.
 */
export async function checkAiQuota({
  userId,
  companyId,
  calls = 1,
}: {
  userId: string;
  companyId: string;
  calls?: number;
}): Promise<string | null> {
  const user = await rateLimit(`ai:user:${userId}`, AI_USER_LIMIT);
  if (!user.allowed) {
    return `You're using AI features too quickly. Try again in ${retryMessage(user.retryAfterSeconds)}.`;
  }
  const company = await rateLimit(`ai:company:${companyId}`, AI_COMPANY_LIMIT, calls);
  if (!company.allowed) {
    return `Your workspace has reached its hourly AI limit. Try again in ${retryMessage(company.retryAfterSeconds)}.`;
  }
  return null;
}
