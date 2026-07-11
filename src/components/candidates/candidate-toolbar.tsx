"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CANDIDATE_SOURCE_LABELS } from "@/components/shared/status-badges";
import { CANDIDATE_SOURCES } from "@/lib/validators/enums";
import type { CandidateSource } from "@/lib/validators/enums";

const SORT_OPTIONS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "name", label: "Name A–Z" },
] as const;

const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_INPUT_ID = "candidate-search";

function searchInputIsFocused(): boolean {
  return (
    typeof document !== "undefined" &&
    document.activeElement instanceof HTMLElement &&
    document.activeElement.id === SEARCH_INPUT_ID
  );
}

export function CandidateToolbar({
  q,
  source,
  sort,
}: {
  q: string;
  source: CandidateSource | undefined;
  sort: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [value, setValue] = useState(q);
  const [prevQ, setPrevQ] = useState(q);

  // Sync from the URL (back button, shared link) — but never clobber the
  // field while the user is typing in it.
  if (prevQ !== q) {
    setPrevQ(q);
    if (!searchInputIsFocused()) {
      setValue(q);
    }
  }

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  function replaceWith(params: URLSearchParams) {
    params.delete("page");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  function handleSearchChange(next: string) {
    setValue(next);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (next.trim()) {
        params.set("q", next.trim());
      } else {
        params.delete("q");
      }
      replaceWith(params);
    }, SEARCH_DEBOUNCE_MS);
  }

  function updateParam(key: string, next: string | undefined) {
    const params = new URLSearchParams(searchParams.toString());
    if (next) {
      params.set(key, next);
    } else {
      params.delete(key);
    }
    replaceWith(params);
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative flex-1 sm:max-w-xs">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          id={SEARCH_INPUT_ID}
          value={value}
          onChange={(event) => handleSearchChange(event.target.value)}
          placeholder="Search name or email…"
          className="pl-9"
          aria-label="Search candidates"
        />
      </div>
      <Select
        value={source ?? "all"}
        onValueChange={(next) => updateParam("source", next === "all" ? undefined : next)}
      >
        <SelectTrigger size="sm" className="w-40" aria-label="Filter by source">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All sources</SelectItem>
          {CANDIDATE_SOURCES.map((option) => (
            <SelectItem key={option} value={option}>
              {CANDIDATE_SOURCE_LABELS[option]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={sort}
        onValueChange={(next) => updateParam("sort", next === "newest" ? undefined : next)}
      >
        <SelectTrigger size="sm" className="w-36" aria-label="Sort candidates">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SORT_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
