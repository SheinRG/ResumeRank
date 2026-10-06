import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { CandidateForm } from "@/components/candidates/candidate-form";
import { canWrite, requireUser } from "@/lib/auth/guards";

export const metadata: Metadata = { title: "New candidate" };

export default async function NewCandidatePage() {
  const user = await requireUser();
  if (!canWrite(user.role)) {
    redirect("/candidates");
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="New candidate"
        description="Paste the resume text — that's what the AI scores against."
      />
      <Card>
        <CardContent>
          <CandidateForm mode="create" />
        </CardContent>
      </Card>
    </div>
  );
}
