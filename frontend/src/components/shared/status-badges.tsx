import type { CSSProperties } from "react";

import type {
  CandidateSource,
  JobStatus,
  Stage,
  Verdict,
} from "@resumerank/core/generated/prisma/enums";
import { cn } from "@/lib/utils";

const badgeBase =
  "inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 font-mono text-[10px] tracking-[0.05em] uppercase";

// Tint a chip from a single design token: solid text, a faint border, and a
// barely-there fill — the redesign's chip language, driven entirely by the
// stage/verdict color tokens so light and dark both stay in system.
function chip(token: string): CSSProperties {
  return {
    color: `var(${token})`,
    borderColor: `color-mix(in srgb, var(${token}) 32%, transparent)`,
    backgroundColor: `color-mix(in srgb, var(${token}) 9%, transparent)`,
  };
}

export const STAGE_LABELS: Record<Stage, string> = {
  NEW: "New",
  SCREENING: "Screening",
  SHORTLISTED: "Shortlisted",
  INTERVIEW: "Interview",
  OFFER: "Offer",
  HIRED: "Hired",
  REJECTED: "Rejected",
};

const STAGE_TOKENS: Record<Stage, string> = {
  NEW: "--stage-new",
  SCREENING: "--stage-screening",
  SHORTLISTED: "--stage-shortlisted",
  INTERVIEW: "--stage-interview",
  OFFER: "--stage-offer",
  HIRED: "--stage-hired",
  REJECTED: "--stage-rejected",
};

export function StageBadge({
  stage,
  className,
}: {
  stage: Stage;
  className?: string;
}) {
  return (
    <span className={cn(badgeBase, className)} style={chip(STAGE_TOKENS[stage])}>
      {STAGE_LABELS[stage]}
    </span>
  );
}

export const VERDICT_LABELS: Record<Verdict, string> = {
  STRONG: "Strong",
  PARTIAL: "Partial",
  MISSING: "Missing",
};

const VERDICT_TOKENS: Record<Verdict, string> = {
  STRONG: "--verdict-strong",
  PARTIAL: "--verdict-partial",
  MISSING: "--verdict-missing",
};

export function VerdictBadge({
  verdict,
  className,
}: {
  verdict: Verdict;
  className?: string;
}) {
  return (
    <span
      className={cn(badgeBase, className)}
      style={chip(VERDICT_TOKENS[verdict])}
    >
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

const JOB_STATUS_TOKENS: Record<JobStatus, string> = {
  DRAFT: "--stage-new",
  OPEN: "--stage-hired",
  CLOSED: "--stage-shortlisted",
  ARCHIVED: "--stage-new",
};

export function JobStatusBadge({
  status,
  className,
}: {
  status: JobStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(badgeBase, className)}
      style={chip(JOB_STATUS_TOKENS[status])}
    >
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
        "border-border text-muted-foreground",
        className,
      )}
    >
      {CANDIDATE_SOURCE_LABELS[source]}
    </span>
  );
}

function scoreTone(score: number): string {
  if (score >= 70) return "text-verdict-strong";
  if (score >= 40) return "text-verdict-partial";
  return "text-verdict-missing";
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
        "font-display-app text-base font-semibold tabular-nums",
        scoreTone(score),
        className,
      )}
    >
      {score}
    </span>
  );
}
