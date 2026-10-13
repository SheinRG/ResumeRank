import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { JobForm } from "@/components/jobs/job-form";
import { can, requireUser } from "@/lib/auth/guards";

export const metadata: Metadata = { title: "New job" };

export default async function NewJobPage() {
  const user = await requireUser();
  if (!can(user.role, "job.manage")) {
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
