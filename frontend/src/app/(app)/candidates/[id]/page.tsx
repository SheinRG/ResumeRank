import type { Metadata } from "next";
import { DateText } from "@/components/format/format-provider";
import { FileJson, FileText, Mail, Pencil } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import {
  CandidateSourceBadge,
  ScorePill,
  StageBadge,
} from "@/components/shared/status-badges";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DeleteCandidateDialog } from "@/components/candidates/delete-candidate-dialog";
import { ResumeFiles } from "@/components/candidates/resume-files";
import { ResumeText } from "@/components/candidates/resume-text";
import { CandidateAiCard } from "@/components/compliance/candidate-ai-card";
import { StepUpDownload } from "@/components/step-up/step-up-download";
import { can, canAdmin, requireUser } from "@/lib/auth/guards";
import { getCandidate } from "@/server/queries/candidates";
import { getResumeFilesPanel } from "@/server/queries/resume-files";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const candidate = await getCandidate(id);
  return {
    title: candidate ? `${candidate.name} · Candidates` : "Candidate",
  };
}

export default async function CandidatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [user, candidate, resumeFiles] = await Promise.all([
    requireUser(),
    getCandidate(id),
    getResumeFilesPanel(id),
  ]);
  if (!candidate) notFound();

  const canManage = can(user.role, "candidate.manage");
  const showScores = can(user.role, "scoring.view");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={candidate.name}
        description={candidate.headline ?? undefined}
        actions={
          canManage ? (
            <>
              {canAdmin(user.role) ? (
                <StepUpDownload
                  href={`/candidates/${candidate.id}/data-export`}
                  icon={<FileJson aria-hidden="true" />}
                >
                  Export data
                </StepUpDownload>
              ) : null}
              <Button asChild variant="outline">
                <Link href={`/candidates/${candidate.id}/edit`}>
                  <Pencil aria-hidden="true" />
                  Edit
                </Link>
              </Button>
              <DeleteCandidateDialog
                candidateId={candidate.id}
                candidateName={candidate.name}
                applicationCount={candidate.applications.length}
              />
            </>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Mail className="size-4" aria-hidden="true" />
          {candidate.email}
        </span>
        <CandidateSourceBadge source={candidate.source} />
        <span>
          Added <DateText value={candidate.createdAt} />
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Resume</CardTitle>
            <CardDescription>The text the AI scores against.</CardDescription>
          </CardHeader>
          <CardContent>
            <ResumeText text={candidate.resumeText} />
          </CardContent>
        </Card>

        <div className="flex h-fit flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Resume files</CardTitle>
              <CardDescription>The uploaded originals, kept as they were sent.</CardDescription>
            </CardHeader>
            <CardContent>
              <ResumeFiles
                candidateId={candidate.id}
                files={resumeFiles.files}
                canUpload={resumeFiles.canUpload}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Applications</CardTitle>
              <CardDescription>
                {candidate.applications.length === 0
                  ? "Not attached to any job yet."
                  : `Attached to ${candidate.applications.length} job${
                      candidate.applications.length === 1 ? "" : "s"
                    }.`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {candidate.applications.length === 0 ? (
                <EmptyState
                  icon={FileText}
                  title="No applications"
                  description="Attach this candidate to a job from the job's page to start scoring."
                />
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {candidate.applications.map((application) => (
                    <li
                      key={application.id}
                      className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                    >
                      <div className="flex min-w-0 flex-col gap-1">
                        <Link
                          href={`/applications/${application.id}`}
                          className="truncate font-medium text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:rounded-sm"
                        >
                          {application.job.title}
                        </Link>
                        <span className="text-xs text-muted-foreground">
                          <DateText value={application.createdAt} />
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <StageBadge stage={application.stage} />
                        {showScores ? <ScorePill score={application.aiScore} /> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <CandidateAiCard
            candidateId={candidate.id}
            aiNoticeAt={candidate.aiNoticeAt}
            aiOptOutAt={candidate.aiOptOutAt}
            canManage={canManage}
          />
        </div>
      </div>
    </div>
  );
}
