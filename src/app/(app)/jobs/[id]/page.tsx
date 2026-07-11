import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, Users } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { JobStatusBadge } from "@/components/shared/status-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AddCandidateDialog } from "@/components/jobs/add-candidate-dialog";
import { ApplicantsTable } from "@/components/jobs/applicants-table";
import { ApplicantsToolbar } from "@/components/jobs/applicants-toolbar";
import { JobActionsMenu } from "@/components/jobs/job-actions-menu";
import { PaginationControl } from "@/components/jobs/pagination-control";
import {
  EMPLOYMENT_TYPE_LABELS,
  REQUIREMENT_WEIGHT_LABELS,
} from "@/components/jobs/labels";
import { formatDate } from "@/lib/format";
import { canWrite, requireUser } from "@/lib/auth/guards";
import { applicationListParamsSchema } from "@/lib/validators/search";
import { listApplicationsForJob } from "@/server/queries/applications";
import { listCandidateOptions, type CandidateOption } from "@/server/queries/candidates";
import { getJob } from "@/server/queries/jobs";

type JobDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const job = await getJob(id);
  return { title: job ? `${job.title} · ResumeRank` : "Job · ResumeRank" };
}

export default async function JobDetailPage({ params, searchParams }: JobDetailPageProps) {
  const [{ id }, raw] = await Promise.all([params, searchParams]);

  const listParams = applicationListParamsSchema.parse({
    q: typeof raw.q === "string" ? raw.q : undefined,
    stage: typeof raw.stage === "string" ? raw.stage : undefined,
    sort: typeof raw.sort === "string" ? raw.sort : undefined,
    page: typeof raw.page === "string" ? raw.page : undefined,
  });

  const user = await requireUser();
  const writer = canWrite(user.role);

  const job = await getJob(id);
  if (!job) {
    notFound();
  }

  const [applications, candidates] = await Promise.all([
    listApplicationsForJob(job.id, listParams),
    writer ? listCandidateOptions() : Promise.resolve<CandidateOption[]>([]),
  ]);

  const hasFilters = listParams.q.trim() !== "" || listParams.stage !== undefined;
  const metaLine = [
    job.location,
    EMPLOYMENT_TYPE_LABELS[job.employmentType],
    `Created ${formatDate(job.createdAt)}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={job.title}
        description={metaLine}
        actions={
          <div className="flex items-center gap-3">
            <JobStatusBadge status={job.status} />
            {writer ? (
              <JobActionsMenu jobId={job.id} status={job.status} title={job.title} />
            ) : null}
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Description</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
              {job.description}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Requirements</CardTitle>
            <CardDescription>
              The rubric AI scoring grades every applicant against.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {job.requirements.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No requirements yet.{" "}
                {writer ? (
                  <Link
                    href={`/jobs/${job.id}/edit`}
                    className="font-medium text-primary hover:underline"
                  >
                    Add some
                  </Link>
                ) : null}
              </p>
            ) : (
              <ol className="flex flex-col gap-2">
                {job.requirements.map((requirement, index) => (
                  <li
                    key={requirement.id}
                    className="flex items-start justify-between gap-3 rounded-md border border-border p-3"
                  >
                    <span className="text-sm text-foreground">
                      <span className="mr-2 tabular-nums text-muted-foreground">
                        {index + 1}.
                      </span>
                      {requirement.label}
                    </span>
                    <Badge
                      variant={requirement.weight === "MUST" ? "default" : "outline"}
                      className="shrink-0"
                    >
                      {REQUIREMENT_WEIGHT_LABELS[requirement.weight]}
                    </Badge>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1.5">
              <CardTitle>Applicants</CardTitle>
              <CardDescription>
                {applications.total} applicant{applications.total === 1 ? "" : "s"}, ranked by
                score.
              </CardDescription>
            </div>
            {writer ? <AddCandidateDialog jobId={job.id} candidates={candidates} /> : null}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {job.requirements.length === 0 ? (
            <div
              role="status"
              className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>
                Scoring is disabled until this job has requirements.{" "}
                {writer ? (
                  <Link
                    href={`/jobs/${job.id}/edit`}
                    className="font-medium underline underline-offset-2 outline-none hover:no-underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    Add requirements
                  </Link>
                ) : null}
              </p>
            </div>
          ) : null}

          <ApplicantsToolbar q={listParams.q} stage={listParams.stage} sort={listParams.sort} />

          {applications.items.length === 0 ? (
            hasFilters ? (
              <EmptyState
                icon={Users}
                title="No applicants match"
                description="Try a different search or stage, or clear the filters."
                action={
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/jobs/${job.id}`}>Clear filters</Link>
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={Users}
                title="No applicants yet"
                description="Attach a candidate to start scoring them against this job's requirements."
                action={
                  writer ? (
                    <AddCandidateDialog jobId={job.id} candidates={candidates} />
                  ) : undefined
                }
              />
            )
          ) : (
            <>
              <ApplicantsTable items={applications.items} canWrite={writer} />
              <PaginationControl page={applications.page} pageCount={applications.pageCount} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
