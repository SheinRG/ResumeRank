import type { DatabaseDriver, Encrypted, Index, Records, SortOrder } from "@boxyhq/saml-jackson";

import { db } from "../db";
import { errorFields, log } from "../observability/log";
import type { Prisma } from "../generated/prisma/client";

/**
 * Jackson's storage contract over our own Postgres, in place of its bundled
 * TypeORM driver. The tables live in the Prisma schema, so they ride the
 * normal migrations and drift check, and every query shares the app's pool
 * instead of opening a second one per serverless instance.
 *
 * Jackson encrypts values before calling `put`, so rows hold ciphertext;
 * this layer only stores, expires and indexes them.
 */

const DEFAULT_PAGE_LIMIT = 50;
const PRUNE_PROBABILITY = 0.02;
const PRUNE_BATCH = 500;

function recordKey(namespace: string, key: string): string {
  return `${namespace}:${key}`;
}

function indexKey(namespace: string, index: Index): string {
  return `${namespace}:${index.name}:${index.value}`;
}

function live(now: Date): Prisma.SsoRecordWhereInput {
  return { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };
}

function page(pageOffset: number | undefined, pageLimit: number | undefined) {
  const skip = pageOffset !== undefined && Number.isFinite(pageOffset) && pageOffset > 0 ? pageOffset : 0;
  const take =
    pageLimit !== undefined && Number.isFinite(pageLimit) && pageLimit > 0
      ? Math.min(pageLimit, DEFAULT_PAGE_LIMIT)
      : DEFAULT_PAGE_LIMIT;
  return { skip, take };
}

function direction(sortOrder: SortOrder | undefined): Prisma.SortOrder {
  return sortOrder === "ASC" ? "asc" : "desc";
}

const VALUE_SELECT = { value: true, iv: true, tag: true } satisfies Prisma.SsoRecordSelect;

function toEncrypted(row: { value: string; iv: string | null; tag: string | null }): Encrypted {
  return { value: row.value, iv: row.iv ?? undefined, tag: row.tag ?? undefined };
}

/**
 * Login state (sessions, codes, tokens) expires within minutes; reads already
 * ignore expired rows, so sweeping them is housekeeping done opportunistically.
 */
function maybePrune(now: Date): void {
  if (Math.random() >= PRUNE_PROBABILITY) return;
  db.$executeRaw`
    DELETE FROM "SsoRecord"
    WHERE "key" IN (
      SELECT "key" FROM "SsoRecord"
      WHERE "expiresAt" IS NOT NULL AND "expiresAt" <= ${now}::timestamp(3)
      LIMIT ${PRUNE_BATCH}
    )
  `.catch((error: unknown) => log.warn("sso.store.prune_failed", errorFields(error)));
}

export const ssoStore: DatabaseDriver = {
  async get(namespace: string, key: string): Promise<Encrypted | null> {
    const row = await db.ssoRecord.findFirst({
      where: { key: recordKey(namespace, key), ...live(new Date()) },
      select: VALUE_SELECT,
    });
    return row ? toEncrypted(row) : null;
  },

  async getAll(
    namespace: string,
    pageOffset?: number,
    pageLimit?: number,
    _pageToken?: string,
    sortOrder?: SortOrder,
  ): Promise<Records<Encrypted>> {
    const rows = await db.ssoRecord.findMany({
      where: { namespace, ...live(new Date()) },
      select: VALUE_SELECT,
      orderBy: [{ createdAt: direction(sortOrder) }, { key: direction(sortOrder) }],
      ...page(pageOffset, pageLimit),
    });
    return { data: rows.map(toEncrypted) };
  },

  async getByIndex(
    namespace: string,
    index: Index,
    pageOffset?: number,
    pageLimit?: number,
    _pageToken?: string,
    sortOrder?: SortOrder,
  ): Promise<Records<Encrypted>> {
    const rows = await db.ssoRecordIndex.findMany({
      where: { key: indexKey(namespace, index), record: live(new Date()) },
      select: { record: { select: VALUE_SELECT } },
      orderBy: [{ record: { createdAt: direction(sortOrder) } }, { recordKey: direction(sortOrder) }],
      ...page(pageOffset, pageLimit),
    });
    return { data: rows.map((row) => toEncrypted(row.record)) };
  },

  async getCount(namespace: string, index?: Index): Promise<number> {
    const now = new Date();
    if (index) {
      return db.ssoRecordIndex.count({ where: { key: indexKey(namespace, index), record: live(now) } });
    }
    return db.ssoRecord.count({ where: { namespace, ...live(now) } });
  },

  async put(namespace: string, key: string, val: Encrypted, ttl: number, ...indexes: Index[]): Promise<void> {
    const now = new Date();
    const fullKey = recordKey(namespace, key);
    const fields = {
      namespace,
      value: val.value,
      iv: val.iv ?? null,
      tag: val.tag ?? null,
      expiresAt: ttl > 0 ? new Date(now.getTime() + ttl * 1000) : null,
    };
    await db.$transaction([
      db.ssoRecord.upsert({
        where: { key: fullKey },
        create: { key: fullKey, ...fields },
        update: fields,
      }),
      db.ssoRecordIndex.createMany({
        data: indexes.map((index) => ({ key: indexKey(namespace, index), recordKey: fullKey })),
        skipDuplicates: true,
      }),
    ]);
    maybePrune(now);
  },

  async delete(namespace: string, key: string): Promise<void> {
    await db.ssoRecord.deleteMany({ where: { key: recordKey(namespace, key) } });
  },

  async deleteMany(namespace: string, keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    await db.ssoRecord.deleteMany({ where: { key: { in: keys.map((key) => recordKey(namespace, key)) } } });
  },

  async close(): Promise<void> {},

  getStats(): Record<string, number> {
    return {};
  },
};
