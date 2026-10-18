import { TriangleAlert } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import type { ImpactReportView } from "@/server/queries/compliance";
import type { JobOption } from "@/server/queries/jobs";

import { categoryLabel, FOUR_FIFTHS } from "./impact-labels";
import { ImpactReportControls } from "./impact-report-controls";

type ImpactTable = ImpactReportView["sex"];

function percent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function Ratio({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  const low = value < FOUR_FIFTHS;
  return (
    <span className={low ? "inline-flex items-center gap-1 font-medium text-verdict-missing" : undefined}>
      {low ? <TriangleAlert className="size-3.5" aria-label="Below four-fifths" /> : null}
      {value.toFixed(2)}
    </span>
  );
}

function ImpactTableView({ title, table }: { title: string; table: ImpactTable }) {
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {table.rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          No answers for this category yet. {table.unknown} applicant{table.unknown === 1 ? "" : "s"} without one.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Applicants</TableHead>
                <TableHead className="text-right">Selected</TableHead>
                <TableHead className="text-right">Selection rate</TableHead>
                <TableHead className="text-right">Impact ratio</TableHead>
                <TableHead className="text-right">Scored</TableHead>
                <TableHead className="text-right">Scoring rate</TableHead>
                <TableHead className="text-right">Impact ratio</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {table.rows.map((row) => (
                <TableRow key={row.category}>
                  <TableCell className="font-medium">
                    {categoryLabel(row.category)}
                    {row.smallSample ? (
                      <span className="ml-2 font-mono text-xs text-muted-foreground">under 2%</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right font-mono">{row.applicants}</TableCell>
                  <TableCell className="text-right font-mono">{row.selected}</TableCell>
                  <TableCell className="text-right font-mono">{percent(row.selectionRate)}</TableCell>
                  <TableCell className="text-right font-mono">
                    <Ratio value={row.selectionImpactRatio} />
                  </TableCell>
                  <TableCell className="text-right font-mono">{row.scored}</TableCell>
                  <TableCell className="text-right font-mono">{percent(row.scoringRate)}</TableCell>
                  <TableCell className="text-right font-mono">
                    <Ratio value={row.scoringImpactRatio} />
                  </TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="text-muted-foreground">Unknown (no answer)</TableCell>
                <TableCell className="text-right font-mono text-muted-foreground">{table.unknown}</TableCell>
                <TableCell colSpan={6} />
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}

export function ImpactReport({ report, jobs, jobId }: { report: ImpactReportView; jobs: JobOption[]; jobId: string | null }) {
  const responded = report.applicants - report.intersectional.unknown;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Impact ratio report</CardTitle>
        <CardDescription>
          Selection and scoring rates by sex and race/ethnicity, from candidates&apos; voluntary
          self-identification, in the format New York City&apos;s Local Law 144 bias audits use. Selected means
          currently shortlisted or further along; the scoring rate is the share scoring above the median AI
          score ({report.medianScore === null ? "no scores yet" : report.medianScore}). An impact ratio under
          0.80 is flagged for a closer look. This report supports an independent bias audit; it isn&apos;t one.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <ImpactReportControls jobs={jobs} jobId={jobId} report={report} />
        <p className="text-sm text-muted-foreground">
          {report.jobTitle ? `${report.jobTitle}: ` : "All jobs: "}
          {report.applicants} applicant{report.applicants === 1 ? "" : "s"}, {responded} answered both questions.
          Generated {formatDate(report.generatedAt)}.
        </p>
        {report.applicants === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            No applicants yet. Send candidates their self-identification link from the application page;
            their answers appear here in aggregate only.
          </p>
        ) : (
          <>
            <ImpactTableView title="Sex" table={report.sex} />
            <ImpactTableView title="Race / ethnicity" table={report.race} />
            <ImpactTableView title="Intersectional" table={report.intersectional} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
