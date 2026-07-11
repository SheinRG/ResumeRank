import type {
  CandidateSource,
  JobStatus,
  Stage,
  Verdict,
} from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

const badgeBase =
  "inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium";

export const STAGE_LABELS: Record<Stage, string> = {
  NEW: "New",
  SCREENING: "Screening",
  SHORTLISTED: "Shortlisted",
  INTERVIEW: "Interview",
  OFFER: "Offer",
  HIRED: "Hired",
  REJECTED: "Rejected",
};

const STAGE_CLASSES: Record<Stage, string> = {
  NEW: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  SCREENING: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  SHORTLISTED:
    "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
  INTERVIEW:
    "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  OFFER: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  HIRED:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  REJECTED: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
};

export function StageBadge({
  stage,
  className,
}: {
  stage: Stage;
  className?: string;
}) {
  return (
    <span className={cn(badgeBase, STAGE_CLASSES[stage], className)}>
      {STAGE_LABELS[stage]}
    </span>
  );
}

export const VERDICT_LABELS: Record<Verdict, string> = {
  STRONG: "Strong",
  PARTIAL: "Partial",
  MISSING: "Missing",
};

const VERDICT_CLASSES: Record<Verdict, string> = {
  STRONG:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  PARTIAL: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  MISSING: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
};

export function VerdictBadge({
  verdict,
  className,
}: {
  verdict: Verdict;
  className?: string;
}) {
  return (
    <span className={cn(badgeBase, VERDICT_CLASSES[verdict], className)}>
      {VERDICT_LABELS[verdict]}
    </span>
  );
}

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  DRAFT: "Draft",
  OPEN: "Open",
  CLOSED: "Closed",
  ARCHIVED: "Archived",
};

const JOB_STATUS_CLASSES: Record<JobStatus, string> = {
  DRAFT: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  OPEN: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  CLOSED: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  ARCHIVED: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

export function JobStatusBadge({
  status,
  className,
}: {
  status: JobStatus;
  className?: string;
}) {
  return (
    <span className={cn(badgeBase, JOB_STATUS_CLASSES[status], className)}>
      {JOB_STATUS_LABELS[status]}
    </span>
  );
}

export const CANDIDATE_SOURCE_LABELS: Record<CandidateSource, string> = {
  MANUAL: "Manual",
  REFERRAL: "Referral",
  JOB_BOARD: "Job board",
  OUTREACH: "Outreach",
  OTHER: "Other",
};

export function CandidateSourceBadge({
  source,
  className,
}: {
  source: CandidateSource;
  className?: string;
}) {
  return (
    <span
      className={cn(
        badgeBase,
        "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
        className,
      )}
    >
      {CANDIDATE_SOURCE_LABELS[source]}
    </span>
  );
}

function scoreTone(score: number): string {
  if (score >= 70) {
    return "text-emerald-600 dark:text-emerald-400";
  }
  if (score >= 40) {
    return "text-amber-600 dark:text-amber-400";
  }
  return "text-rose-600 dark:text-rose-400";
}

export function ScorePill({
  score,
  className,
}: {
  score: number | null;
  className?: string;
}) {
  if (score === null) {
    return (
      <span
        className={cn("text-sm text-muted-foreground tabular-nums", className)}
      >
        —
      </span>
    );
  }
  return (
    <span
      className={cn(
        "text-sm font-semibold tabular-nums",
        scoreTone(score),
        className,
      )}
    >
      {score}
    </span>
  );
}
