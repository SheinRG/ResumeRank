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
import { STAGE_LABELS } from "@/components/shared/status-badges";
import { STAGES } from "@/lib/validators/enums";
import type { Stage } from "@/lib/validators/enums";
import type { ApplicationListParams } from "@/lib/validators/search";

const SORT_OPTIONS: { value: ApplicationListParams["sort"]; label: string }[] = [
  { value: "score", label: "Highest score" },
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
];

export function ApplicantsToolbar({
  q,
  stage,
  sort,
}: {
  q: string;
  stage?: Stage;
  sort: ApplicationListParams["sort"];
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
          placeholder="Search candidates…"
          className="pl-9"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Search applicants by candidate name"
        />
      </div>
      <Select value={stage ?? "all"} onValueChange={(value) => updateParam("stage", value, "all")}>
        <SelectTrigger size="sm" className="w-40" aria-label="Filter by stage">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All stages</SelectItem>
          {STAGES.map((value) => (
            <SelectItem key={value} value={value}>
              {STAGE_LABELS[value]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={sort} onValueChange={(value) => updateParam("sort", value, "score")}>
        <SelectTrigger size="sm" className="w-40" aria-label="Sort applicants">
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
