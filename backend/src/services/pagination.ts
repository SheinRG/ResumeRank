import { z } from "zod";

import { PAGE_SIZE } from "../validators/search";

/**
 * Counts stop here: an exact count walks every matching row, so past this
 * point lists report "1,000+" instead of paying for it on every page.
 */
export const COUNT_CAP = 1000;

export type SortDirection = "asc" | "desc";
export type CursorKey = string | number | null;

/** Where the next query starts: the first page, or strictly after/before a row. */
export interface PageParams {
  after?: string;
  before?: string;
}

/**
 * One way of ordering a list for keyset pagination. The id tie-breaker sorts
 * in the key's direction, so a single index serves the forward scan (Next)
 * and the reversed one (Prev).
 */
export interface KeysetSort<K, W, O, R> {
  direction: SortDirection;
  /** Narrows a decoded cursor key, or rejects it (undefined) so the list restarts at page one. */
  parseKey: (raw: CursorKey) => K | undefined;
  /** Rows strictly past (key, id) when scanning in `scan` order. */
  seekWhere: (key: K, id: string, scan: SortDirection) => W;
  orderBy: (scan: SortDirection) => O;
  keyOf: (row: R) => Date | string | number | null;
}

export interface KeysetQuery<W, O> {
  where: W | undefined;
  orderBy: O;
  take: number;
}

export interface PageSlice<R> {
  items: R[];
  nextCursor: string | null;
  prevCursor: string | null;
}

interface Seek<K> {
  key: K;
  id: string;
  direction: "after" | "before";
}

const cursorSchema = z.tuple([z.union([z.string(), z.number(), z.null()]), z.string().min(1)]);

export function encodeCursor(key: Date | string | number | null, id: string): string {
  const value = key instanceof Date ? key.toISOString() : key;
  return Buffer.from(JSON.stringify([value, id])).toString("base64url");
}

export function decodeCursor(raw: string): { key: CursorKey; id: string } | null {
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(raw, "base64url").toString()));
    return parsed.success ? { key: parsed.data[0], id: parsed.data[1] } : null;
  } catch {
    return null;
  }
}

function flipDirection(direction: SortDirection): SortDirection {
  return direction === "asc" ? "desc" : "asc";
}

/** Strictly past `value` in scan order. */
export function past<T>(direction: SortDirection, value: T): { lt: T } | { gt: T } {
  return direction === "desc" ? { lt: value } : { gt: value };
}

/**
 * `value` or past it. Redundant next to the exact keyset condition, but it is
 * the bound Postgres can seek the index with instead of filtering from the start.
 */
export function through<T>(direction: SortDirection, value: T): { lte: T } | { gte: T } {
  return direction === "desc" ? { lte: value } : { gte: value };
}

export function parseDateKey(raw: CursorKey): Date | undefined {
  if (typeof raw !== "string") return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function parseStringKey(raw: CursorKey): string | undefined {
  return typeof raw === "string" ? raw : undefined;
}

export function parseNullableNumberKey(raw: CursorKey): number | null | undefined {
  return raw === null || typeof raw === "number" ? raw : undefined;
}

type CreatedAtWhere = {
  createdAt: { lte: Date } | { gte: Date };
  OR: [{ createdAt: { lt: Date } | { gt: Date } }, { createdAt: Date; id: { lt: string } | { gt: string } }];
};
type CreatedAtOrderBy = [{ createdAt: SortDirection }, { id: SortDirection }];

/** Newest/oldest ordering, shared by every model with `createdAt` and a string id. */
export function createdAtSort<R extends { id: string; createdAt: Date }>(
  direction: SortDirection,
): KeysetSort<Date, CreatedAtWhere, CreatedAtOrderBy, R> {
  return {
    direction,
    parseKey: parseDateKey,
    seekWhere: (key, id, scan) => ({
      createdAt: through(scan, key),
      OR: [{ createdAt: past(scan, key) }, { createdAt: key, id: past(scan, id) }],
    }),
    orderBy: (scan) => [{ createdAt: scan }, { id: scan }],
    keyOf: (row) => row.createdAt,
  };
}

function resolveSeek<K>(
  parseKey: (raw: CursorKey) => K | undefined,
  params: PageParams,
): Seek<K> | null {
  const direction = params.after ? "after" : params.before ? "before" : null;
  const raw = params.after ?? params.before;
  if (!direction || !raw) return null;
  const cursor = decodeCursor(raw);
  if (!cursor) return null;
  const key = parseKey(cursor.key);
  return key === undefined ? null : { key, id: cursor.id, direction };
}

/**
 * Fetches one page by keyset. A `before` page scans backwards from the cursor
 * and is flipped back; when fewer than a page of rows precede it, or an
 * `after` cursor has nothing past it (rows deleted since), the first page is
 * returned instead, as offset pagination used to clamp an overflowing page.
 */
export async function keysetPage<K, W, O, R extends { id: string }>(
  sort: KeysetSort<K, W, O, R>,
  params: PageParams,
  fetch: (query: KeysetQuery<W, O>) => Promise<R[]>,
  pageSize: number = PAGE_SIZE,
): Promise<PageSlice<R>> {
  const cursorOf = (row: R) => encodeCursor(sort.keyOf(row), row.id);
  const seek = resolveSeek(sort.parseKey, params);

  if (seek) {
    const scan = seek.direction === "before" ? flipDirection(sort.direction) : sort.direction;
    const rows = await fetch({
      where: sort.seekWhere(seek.key, seek.id, scan),
      orderBy: sort.orderBy(scan),
      take: pageSize + 1,
    });
    if (seek.direction === "after" && rows.length > 0) {
      const items = rows.slice(0, pageSize);
      return {
        items,
        prevCursor: cursorOf(items[0]),
        nextCursor: rows.length > pageSize ? cursorOf(items[items.length - 1]) : null,
      };
    }
    if (seek.direction === "before" && rows.length > pageSize) {
      const items = rows.slice(0, pageSize).reverse();
      return {
        items,
        prevCursor: cursorOf(items[0]),
        nextCursor: cursorOf(items[items.length - 1]),
      };
    }
  }

  const rows = await fetch({
    where: undefined,
    orderBy: sort.orderBy(sort.direction),
    take: pageSize + 1,
  });
  const items = rows.slice(0, pageSize);
  return {
    items,
    prevCursor: null,
    nextCursor: rows.length > pageSize ? cursorOf(items[items.length - 1]) : null,
  };
}

export async function countCapped(
  count: (take: number) => Promise<number>,
): Promise<{ total: number; totalCapped: boolean }> {
  const counted = await count(COUNT_CAP + 1);
  return { total: Math.min(counted, COUNT_CAP), totalCapped: counted > COUNT_CAP };
}
