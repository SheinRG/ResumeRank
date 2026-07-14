import type { Metadata } from "next";
import Link from "next/link";
import { Briefcase, Plus } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { JobStatusBadge, ScorePill } from "@/components/shared/status-badges";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { JobsToolbar } from "@/components/jobs/jobs-toolbar";
import { PaginationControl } from "@/components/shared/pagination-control";
import { EMPLOYMENT_TYPE_LABELS } from "@/components/jobs/labels";
import { formatDate } from "@/lib/format";
import { canWrite, requireUser } from "@/lib/auth/guards";
import { jobListParamsSchema } from "@resumerank/core/validators/search";
import { listJobs } from "@/server/queries/jobs";

export const metadata: Metadata = { title: "Jobs" };

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const params = jobListParamsSchema.parse({
    q: typeof raw.q === "string" ? raw.q : undefined,
    status: typeof raw.status === "string" ? raw.status : undefined,
    sort: typeof raw.sort === "string" ? raw.sort : undefined,
    page: typeof raw.page === "string" ? raw.page : undefined,
  });

  const user = await requireUser();
  const writer = canWrite(user.role);
  const result = await listJobs(params);
  const hasFilters = params.q.trim() !== "" || params.status !== undefined;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Jobs"
        description="Create jobs with structured requirements, then score applicants against them."
        actions={
          writer ? (
            <Button asChild>
              <Link href="/jobs/new">
                <Plus aria-hidden="true" />
                New job
              </Link>
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <JobsToolbar q={params.q} status={params.status} sort={params.sort} />
            {result.total > 0 ? (
              <p className="shrink-0 text-sm text-muted-foreground">
                {result.total} job{result.total === 1 ? "" : "s"}
              </p>
            ) : null}
          </div>

          {result.items.length === 0 ? (
            hasFilters ? (
              <EmptyState
                icon={Briefcase}
                title="No jobs match"
                description="Try a different search or status, or clear the filters to see everything."
                action={
                  <Button asChild variant="outline" size="sm">
                    <Link href="/jobs">Clear filters</Link>
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={Briefcase}
                title="No jobs yet"
                description="Create your first job with a structured requirement list so scoring has a rubric."
                action={
                  writer ? (
                    <Button asChild size="sm">
                      <Link href="/jobs/new">
                        <Plus aria-hidden="true" />
                        Create your first job
                      </Link>
                    </Button>
                  ) : undefined
                }
              />
            )
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Requirements</TableHead>
                    <TableHead className="text-right">Applicants</TableHead>
                    <TableHead className="text-right">Avg score</TableHead>
                    <TableHead className="text-right">Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.items.map((job) => (
                    <TableRow key={job.id}>
                      <TableCell className="max-w-xs truncate">
                        <Link
                          href={`/jobs/${job.id}`}
                          className="font-medium text-foreground outline-none hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring/50"
                        >
                          {job.title}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <JobStatusBadge status={job.status} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {job.location ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {EMPLOYMENT_TYPE_LABELS[job.employmentType]}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {job.requirementCount}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {job.applicationCount}
                      </TableCell>
                      <TableCell className="text-right">
                        <ScorePill score={job.averageScore} />
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {formatDate(job.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <PaginationControl page={result.page} pageCount={result.pageCount} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
