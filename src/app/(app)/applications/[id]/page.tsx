import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { StageBadge } from "@/components/shared/status-badges";
import { ApplicationMenu } from "@/components/applications/application-menu";
import { EvaluationList } from "@/components/applications/evaluation-list";
import { RestoreBanner } from "@/components/applications/restore-banner";
import { ScorePanel } from "@/components/applications/score-panel";
import { ScorecardsPanel } from "@/components/applications/scorecards-panel";
import { StageSelect } from "@/components/applications/stage-select";
import type { ScoreBlocker } from "@/components/applications/score-button";
import { formatDate } from "@/lib/format";
import { canWrite, requireUser } from "@/lib/auth/guards";
import { MIN_RESUME_LENGTH } from "@/lib/validators/candidate";
import { getApplication, type ApplicationDetail } from "@/server/queries/applications";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const application = await getApplication(id);
  return {
    title: application
      ? `${application.candidate.name} — ${application.job.title} · ResumeRank`
      : "Application · ResumeRank",
  };
}

function resolveBlocker(application: ApplicationDetail): ScoreBlocker | undefined {
  if (application.candidate.resumeText.trim().length < MIN_RESUME_LENGTH) {
    return {
      message: `Add at least ${MIN_RESUME_LENGTH} characters of resume text before scoring.`,
      href: `/candidates/${application.candidate.id}/edit`,
      linkLabel: "Edit resume",
    };
  }
  if (application.job.requirements.length === 0) {
    return {
      message: "Add requirements to this job first — scoring needs a rubric.",
      href: `/jobs/${application.job.id}`,
      linkLabel: "Open job",
    };
  }
  return undefined;
}

export default async function ApplicationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [user, application] = await Promise.all([requireUser(), getApplication(id)]);
  if (!application) notFound();

  const deleted = application.deletedAt !== null;
  const writer = canWrite(user.role);
  const canMutate = writer && !deleted;
  const scored = application.aiScore !== null && application.scoredAt !== null;

  return (
    <div className="flex flex-col gap-6">
      {deleted ? <RestoreBanner applicationId={application.id} canRestore={writer} /> : null}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            <Link
              href={`/candidates/${application.candidate.id}`}
              className="outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:rounded-sm"
            >
              {application.candidate.name}
            </Link>
          </h1>
          <p className="text-sm text-muted-foreground">
            applying for{" "}
            <Link
              href={`/jobs/${application.job.id}`}
              className="font-medium text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:rounded-sm"
            >
              {application.job.title}
            </Link>{" "}
            · added {formatDate(application.createdAt)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <StageBadge stage={application.stage} />
          {canMutate ? (
            <>
              <StageSelect applicationId={application.id} stage={application.stage} />
              <ApplicationMenu applicationId={application.id} />
            </>
          ) : null}
        </div>
      </div>

      <ScorePanel
        applicationId={application.id}
        aiScore={application.aiScore}
        aiSummary={application.aiSummary}
        scoredAt={application.scoredAt}
        evaluations={application.evaluations}
        writer={canMutate}
        blocker={resolveBlocker(application)}
      />

      {scored || application.evaluations.length > 0 ? (
        <EvaluationList evaluations={application.evaluations} scored={scored} />
      ) : null}

      <ScorecardsPanel
        applicationId={application.id}
        scorecards={application.scorecards}
        currentUserId={user.id}
        writer={canMutate}
      />
    </div>
  );
}
