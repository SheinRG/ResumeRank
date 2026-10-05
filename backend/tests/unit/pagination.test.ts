import { describe, expect, it } from "vitest";

import {
  countCapped,
  COUNT_CAP,
  decodeCursor,
  encodeCursor,
  keysetPage,
  parseDateKey,
  type KeysetQuery,
  type KeysetSort,
} from "../../src/services/pagination";

interface Row {
  id: string;
  n: number;
}

type Where = { n: number; id: string; scan: "asc" | "desc" };

// An in-memory "table" ordered by (n, id), so keysetPage's paging logic can
// be checked without a database: seekWhere is evaluated here by `fetch`.
const numberSort: KeysetSort<number, Where, "asc" | "desc", Row> = {
  direction: "asc",
  parseKey: (raw) => (typeof raw === "number" ? raw : undefined),
  seekWhere: (key, id, scan) => ({ n: key, id, scan }),
  orderBy: (scan) => scan,
  keyOf: (row) => row.n,
};

function compare(a: Row, b: { n: number; id: string }): number {
  return a.n - b.n || a.id.localeCompare(b.id);
}

function tableFetch(rows: Row[]) {
  return async (query: KeysetQuery<Where, "asc" | "desc">): Promise<Row[]> => {
    const sign = query.orderBy === "asc" ? 1 : -1;
    const where = query.where;
    return [...rows]
      .sort((a, b) => sign * compare(a, b))
      .filter((row) => !where || sign * compare(row, where) > 0)
      .slice(0, query.take);
  };
}

const rows: Row[] = Array.from({ length: 7 }, (_, i) => ({ id: `r${i}`, n: Math.floor(i / 2) }));
const ids = (page: { items: Row[] }) => page.items.map((r) => r.id);

describe("cursor encoding", () => {
  it("round-trips dates as ISO strings", () => {
    const at = new Date("2026-10-05T12:34:56.789Z");
    const cursor = decodeCursor(encodeCursor(at, "abc"));
    expect(cursor).toEqual({ key: at.toISOString(), id: "abc" });
    expect(cursor && parseDateKey(cursor.key)).toEqual(at);
  });

  it("rejects anything that isn't a cursor", () => {
    expect(decodeCursor("not-base64-json")).toBeNull();
    expect(decodeCursor(Buffer.from('{"a":1}').toString("base64url"))).toBeNull();
    expect(parseDateKey("yesterday")).toBeUndefined();
  });
});

describe("keysetPage", () => {
  const fetch = tableFetch(rows);

  it("walks forward and back across every row exactly once", async () => {
    const first = await keysetPage(numberSort, {}, fetch, 3);
    expect(ids(first)).toEqual(["r0", "r1", "r2"]);
    expect(first.prevCursor).toBeNull();

    const second = await keysetPage(numberSort, { after: first.nextCursor ?? "" }, fetch, 3);
    expect(ids(second)).toEqual(["r3", "r4", "r5"]);

    const third = await keysetPage(numberSort, { after: second.nextCursor ?? "" }, fetch, 3);
    expect(ids(third)).toEqual(["r6"]);
    expect(third.nextCursor).toBeNull();

    const back = await keysetPage(numberSort, { before: third.prevCursor ?? "" }, fetch, 3);
    expect(ids(back)).toEqual(["r3", "r4", "r5"]);
    expect(back.nextCursor).not.toBeNull();
  });

  it("returns the first page when fewer than a page precede the cursor", async () => {
    const page = await keysetPage(numberSort, { before: encodeCursor(1, "r2") }, fetch, 3);
    expect(ids(page)).toEqual(["r0", "r1", "r2"]);
    expect(page.prevCursor).toBeNull();
  });

  it("restarts at the first page for a stale or malformed cursor", async () => {
    const pastEnd = await keysetPage(numberSort, { after: encodeCursor(99, "zz") }, fetch, 3);
    expect(ids(pastEnd)).toEqual(["r0", "r1", "r2"]);

    const wrongKind = await keysetPage(numberSort, { after: encodeCursor("x", "r1") }, fetch, 3);
    expect(ids(wrongKind)).toEqual(["r0", "r1", "r2"]);
  });
});

describe("countCapped", () => {
  it("reports exact counts below the cap and flags anything above it", async () => {
    expect(await countCapped(async () => 12)).toEqual({ total: 12, totalCapped: false });
    expect(await countCapped(async (take) => take)).toEqual({
      total: COUNT_CAP,
      totalCapped: true,
    });
  });
});
