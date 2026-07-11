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
import { JOB_STATUS_LABELS } from "@/components/shared/status-badges";
import type { JobListParams } from "@/lib/validators/search";
import type { JobStatus } from "@/lib/validators/enums";

const STATUS_OPTIONS: { value: JobStatus | "all"; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "DRAFT", label: JOB_STATUS_LABELS.DRAFT },
  { value: "OPEN", label: JOB_STATUS_LABELS.OPEN },
  { value: "CLOSED", label: JOB_STATUS_LABELS.CLOSED },
  { value: "ARCHIVED", label: JOB_STATUS_LABELS.ARCHIVED },
];

const SORT_OPTIONS: { value: JobListParams["sort"]; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "title", label: "Title A–Z" },
];

export function JobsToolbar({
  q,
  status,
  sort,
}: {
  q: string;
  status?: JobStatus;
  sort: JobListParams["sort"];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(q);
  // Tracks the last value this component pushed, so URL changes we caused
  // don't clobber text the user typed while navigation was in flight.
  const lastPushed = useRef(q);

  useEffect(() => {
    if (q !== lastPushed.current) {
      lastPushed.current = q;
      setSearch(q);
    }
  }, [q]);

  useEffect(() => {
    const trimmed = search.trim();
    if (trimmed === q) return;
    const handle = setTimeout(() => {
      lastPushed.current = trimmed;
      const params = new URLSearchParams(searchParams.toString());
      if (trimmed) {
        params.set("q", trimmed);
      } else {
        params.delete("q");
      }
      params.delete("page");
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname);
    }, 300);
    return () => clearTimeout(handle);
  }, [search, q, searchParams, pathname, router]);

  function updateParam(key: string, value: string, sentinel: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === sentinel) {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    params.delete("page");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative flex-1 sm:max-w-xs">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          placeholder="Search jobs by title…"
          className="pl-9"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Search jobs by title"
        />
      </div>
      <Select
        value={status ?? "all"}
        onValueChange={(value) => updateParam("status", value, "all")}
      >
        <SelectTrigger size="sm" className="w-40" aria-label="Filter by status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUS_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={sort}
        onValueChange={(value) => updateParam("sort", value, "newest")}
      >
        <SelectTrigger size="sm" className="w-40" aria-label="Sort jobs">
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
