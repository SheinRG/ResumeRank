import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { JobForm } from "@/components/jobs/job-form";
import { canWrite, requireUser } from "@/lib/auth/guards";
import { getJob } from "@/server/queries/jobs";

type EditJobPageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: EditJobPageProps): Promise<Metadata> {
  const { id } = await params;
  const job = await getJob(id);
  return { title: job ? `Edit ${job.title} · ResumeRank` : "Edit job · ResumeRank" };
}

export default async function EditJobPage({ params }: EditJobPageProps) {
  const { id } = await params;

  const user = await requireUser();
  if (!canWrite(user.role)) {
    redirect(`/jobs/${id}`);
  }

  const job = await getJob(id);
  if (!job) {
    notFound();
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader
        title={`Edit ${job.title}`}
        description="Changes to requirements re-shape the scoring rubric for future runs."
      />
      <Card>
        <CardContent>
          <JobForm job={job} />
        </CardContent>
      </Card>
    </div>
  );
}
