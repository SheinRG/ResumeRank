"use client";

import { Download } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ImpactReportView } from "@/server/queries/compliance";
import type { JobOption } from "@/server/queries/jobs";

import { categoryLabel } from "./impact-labels";

const ALL_JOBS = "all";

/** Quoted, with a leading formula character defused so a spreadsheet shows it as text. */
function csvCell(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

function reportCsv(report: ImpactReportView): string {
  const header = [
    "Dimension",
    "Category",
    "Applicants",
    "Selected",
    "Selection rate",
    "Selection impact ratio",
    "Scored",
    "Above median",
    "Scoring rate",
    "Scoring impact ratio",
    "Under 2% of respondents",
  ];
  const lines = [header];
  const tables = [
    ["Sex", report.sex],
    ["Race/ethnicity", report.race],
    ["Intersectional", report.intersectional],
  ] as const;
  for (const [dimension, table] of tables) {
    for (const row of table.rows) {
      lines.push([
        dimension,
        categoryLabel(row.category),
        String(row.applicants),
        String(row.selected),
        row.selectionRate === null ? "" : row.selectionRate.toFixed(4),
        row.selectionImpactRatio === null ? "" : row.selectionImpactRatio.toFixed(4),
        String(row.scored),
        String(row.aboveMedian),
        row.scoringRate === null ? "" : row.scoringRate.toFixed(4),
        row.scoringImpactRatio === null ? "" : row.scoringImpactRatio.toFixed(4),
        row.smallSample ? "yes" : "no",
      ]);
    }
    lines.push([dimension, "Unknown", String(table.unknown), "", "", "", "", "", "", "", ""]);
  }
  const preamble = [
    ["Scope", report.jobTitle ?? "All jobs"],
    ["Median AI score", report.medianScore === null ? "" : String(report.medianScore)],
    ["Generated", new Date(report.generatedAt).toISOString()],
  ];
  return [...preamble, [], ...lines].map((line) => line.map(csvCell).join(",")).join("\r\n");
}

export function ImpactReportControls({
  jobs,
  jobId,
  report,
}: {
  jobs: JobOption[];
  jobId: string | null;
  report: ImpactReportView;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  function chooseJob(value: string) {
    startTransition(() => {
      router.push(value === ALL_JOBS ? pathname : `${pathname}?job=${encodeURIComponent(value)}`);
    });
  }

  function download() {
    const blob = new Blob([reportCsv(report)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `impact-ratios-${new Date(report.generatedAt).toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="impact-job">Job</Label>
        <Select value={jobId ?? ALL_JOBS} onValueChange={chooseJob} disabled={isPending}>
          <SelectTrigger id="impact-job" className="w-full sm:w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_JOBS}>All jobs</SelectItem>
            {jobs.map((job) => (
              <SelectItem key={job.id} value={job.id}>
                {job.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button type="button" variant="outline" className="rounded-full" onClick={download} disabled={report.applicants === 0}>
        <Download aria-hidden="true" />
        Download CSV
      </Button>
    </div>
  );
}
