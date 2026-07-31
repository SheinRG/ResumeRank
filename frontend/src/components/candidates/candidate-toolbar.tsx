"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CANDIDATE_SOURCE_LABELS } from "@/components/shared/status-badges";
import { ToolbarSearch, ToolbarShell } from "@/components/shared/toolbar";
import { useListFilters } from "@/components/shared/use-list-filters";
import { CANDIDATE_SOURCES } from "@resumerank/core/validators/enums";
import type { CandidateSource } from "@resumerank/core/validators/enums";

const SORT_OPTIONS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "name", label: "Name A–Z" },
] as const;

export function CandidateToolbar({
  q,
  source,
  sort,
}: {
  q: string;
  source: CandidateSource | undefined;
  sort: string;
}) {
  const { search, setSearch, setParam } = useListFilters(q);

  return (
    <ToolbarShell>
      <ToolbarSearch
        value={search}
        onChange={setSearch}
        placeholder="Search name or email…"
        label="Search candidates"
      />
      <Select
        value={source ?? "all"}
        onValueChange={(value) => setParam("source", value, "all")}
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
      <Select value={sort} onValueChange={(value) => setParam("sort", value, "newest")}>
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
    </ToolbarShell>
  );
}
