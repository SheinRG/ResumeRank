import { PAGE_SIZE } from "@resumerank/core/validators/search";

export interface PageWindow {
  pageCount: number;
  skip: number;
  take: number;
  /** Requested page clamped to the valid range — what callers should report back. */
  effectivePage: number;
  /** True when the requested page is past the last page; callers should skip the fetch. */
  overflow: boolean;
}

/** Shared skip/take + overflow math so every list query clamps pagination the same way. */
export function resolvePageWindow(page: number, total: number): PageWindow {
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const overflow = page > pageCount;
  const effectivePage = overflow ? pageCount : page;
  return {
    pageCount,
    skip: (effectivePage - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    effectivePage,
    overflow,
  };
}
