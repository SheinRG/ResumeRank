"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";

/**
 * Prev/Next pager that mirrors a keyset cursor (`after` / `before`) into the
 * URL. Shared by the jobs, candidates, applicants, and activity lists.
 */
export function PaginationControl({
  nextCursor,
  prevCursor,
}: {
  nextCursor: string | null;
  prevCursor: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function goTo(param: "after" | "before", cursor: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("after");
    params.delete("before");
    params.set(param, cursor);
    router.replace(`${pathname}?${params.toString()}`);
  }

  if (!nextCursor && !prevCursor) return null;

  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-end gap-2 border-t border-border pt-4"
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!prevCursor}
        onClick={() => prevCursor && goTo("before", prevCursor)}
      >
        <ChevronLeft aria-hidden="true" />
        Prev
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!nextCursor}
        onClick={() => nextCursor && goTo("after", nextCursor)}
      >
        Next
        <ChevronRight aria-hidden="true" />
      </Button>
    </nav>
  );
}
