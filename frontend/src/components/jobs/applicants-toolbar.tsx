"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { STAGE_LABELS } from "@/components/shared/status-badges";
import { ToolbarSearch, ToolbarShell } from "@/components/shared/toolbar";
import { useListFilters } from "@/components/shared/use-list-filters";
import { STAGES } from "@resumerank/core/validators/enums";
import type { Stage } from "@resumerank/core/validators/enums";
import type { ApplicationListParams } from "@resumerank/core/validators/search";

const SORT_OPTIONS: { value: ApplicationListParams["sort"]; label: string }[] = [
  { value: "score", label: "Highest score" },
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
];

export function ApplicantsToolbar({
  q,
  stage,
  sort,
  showScores,
}: {
  q: string;
  stage?: Stage;
  sort: ApplicationListParams["sort"];
  /** Without it the list can't be ranked by score; the server falls back to newest. */
  showScores: boolean;
}) {
  const { search, setSearch, setParam } = useListFilters(q);
  const sortOptions = showScores ? SORT_OPTIONS : SORT_OPTIONS.filter((option) => option.value !== "score");
  const shownSort = showScores || sort !== "score" ? sort : "newest";

  return (
    <ToolbarShell>
      <ToolbarSearch
        value={search}
        onChange={setSearch}
        placeholder="Search candidates…"
        label="Search applicants by candidate name"
      />
      <Select value={stage ?? "all"} onValueChange={(value) => setParam("stage", value, "all")}>
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
      <Select value={shownSort} onValueChange={(value) => setParam("sort", value, "score")}>
        <SelectTrigger size="sm" className="w-40" aria-label="Sort applicants">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {sortOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </ToolbarShell>
  );
}
