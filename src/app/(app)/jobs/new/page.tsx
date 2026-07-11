import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { JobForm } from "@/components/jobs/job-form";
import { canWrite, requireUser } from "@/lib/auth/guards";

export const metadata: Metadata = { title: "New job · ResumeRank" };

export default async function NewJobPage() {
  const user = await requireUser();
  if (!canWrite(user.role)) {
    redirect("/jobs");
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader
        title="New job"
        description="The requirement list is the rubric AI scoring grades candidates against."
      />
      <Card>
        <CardContent>
          <JobForm />
        </CardContent>
      </Card>
    </div>
  );
}
