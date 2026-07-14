"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { JOB_STATUS_LABELS } from "@/components/shared/status-badges";
import { ToolbarSearch, ToolbarShell } from "@/components/shared/toolbar";
import { useListFilters } from "@/components/shared/use-list-filters";
import type { JobListParams } from "@resumerank/core/validators/search";
import type { JobStatus } from "@resumerank/core/validators/enums";

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
  const { search, setSearch, setParam } = useListFilters(q);

  return (
    <ToolbarShell>
      <ToolbarSearch
        value={search}
        onChange={setSearch}
        placeholder="Search jobs by title…"
        label="Search jobs by title"
      />
      <Select
        value={status ?? "all"}
        onValueChange={(value) => setParam("status", value, "all")}
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
      <Select value={sort} onValueChange={(value) => setParam("sort", value, "newest")}>
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
    </ToolbarShell>
  );
}
