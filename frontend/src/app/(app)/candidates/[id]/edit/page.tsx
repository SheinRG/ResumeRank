import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { CandidateForm } from "@/components/candidates/candidate-form";
import { getCandidate } from "@/server/queries/candidates";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const candidate = await getCandidate(id);
  return {
    title: candidate ? `Edit ${candidate.name}` : "Edit candidate",
  };
}

export default async function EditCandidatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const candidate = await getCandidate(id);
  if (!candidate) notFound();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Edit ${candidate.name}`}
        description="Changes to the resume text affect the next scoring run, not existing scores."
      />
      <Card>
        <CardContent>
          <CandidateForm
            mode="edit"
            candidate={{
              id: candidate.id,
              name: candidate.name,
              email: candidate.email,
              headline: candidate.headline,
              source: candidate.source,
              resumeText: candidate.resumeText,
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
