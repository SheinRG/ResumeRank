export interface Paged<T> {
  items: T[];
  /** Exact up to COUNT_CAP; past it `total` is the cap and `totalCapped` is set. */
  total: number;
  totalCapped: boolean;
  pageSize: number;
  /** Opaque keyset cursors for the neighbouring pages; null at either end. */
  nextCursor: string | null;
  prevCursor: string | null;
}
