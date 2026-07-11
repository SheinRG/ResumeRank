import { Sparkles } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { ScoreButton, type ScoreBlocker } from "@/components/applications/score-button";
import { formatDate, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { EvaluationItem } from "@/server/queries/applications";

function ringClasses(score: number): { stroke: string; text: string } {
  if (score >= 70) {
    return {
      stroke: "stroke-emerald-500 dark:stroke-emerald-400",
      text: "text-emerald-600 dark:text-emerald-400",
    };
  }
  if (score >= 40) {
    return {
      stroke: "stroke-amber-500 dark:stroke-amber-400",
      text: "text-amber-600 dark:text-amber-400",
    };
  }
  return {
    stroke: "stroke-rose-500 dark:stroke-rose-400",
    text: "text-rose-600 dark:text-rose-400",
  };
}

function ScoreRing({ score }: { score: number }) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const filled = (score / 100) * circumference;
  const tone = ringClasses(score);

  return (
    <div className="relative size-32 shrink-0">
      <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden="true">
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          strokeWidth="8"
          className="stroke-muted"
        />
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference - filled}`}
          className={tone.stroke}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn("text-4xl font-semibold tabular-nums tracking-tight", tone.text)}>
          {score}
        </span>
        <span className="text-xs text-muted-foreground">/ 100</span>
      </div>
    </div>
  );
}

const TALLY_CLASSES = {
  strong: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  partial: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  missing: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
} as const;

function TallyChip({
  count,
  label,
  tone,
}: {
  count: number;
  label: string;
  tone: keyof typeof TALLY_CLASSES;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium tabular-nums",
        TALLY_CLASSES[tone],
      )}
    >
      {count} {label}
    </span>
  );
}

export function ScorePanel({
  applicationId,
  aiScore,
  aiSummary,
  scoredAt,
  evaluations,
  writer,
  blocker,
}: {
  applicationId: string;
  aiScore: number | null;
  aiSummary: string | null;
  scoredAt: Date | null;
  evaluations: EvaluationItem[];
  writer: boolean;
  blocker?: ScoreBlocker;
}) {
  if (aiScore === null || scoredAt === null) {
    return (
      <Card>
        <CardContent className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Sparkles className="size-6" aria-hidden="true" />
            </div>
            <div className="flex flex-col gap-1">
              <p className="font-medium text-foreground">No AI score yet</p>
              <p className="max-w-md text-sm text-muted-foreground">
                Score this application to get a 0–100 match, a verdict for every
                requirement, and evidence quoted straight from the resume.
              </p>
            </div>
          </div>
          {writer ? (
            <ScoreButton applicationId={applicationId} scored={false} blocker={blocker} />
          ) : null}
        </CardContent>
      </Card>
    );
  }

  const tally = evaluations.reduce(
    (acc, e) => {
      if (e.verdict === "STRONG") acc.strong += 1;
      else if (e.verdict === "PARTIAL") acc.partial += 1;
      else acc.missing += 1;
      return acc;
    },
    { strong: 0, partial: 0, missing: 0 },
  );

  return (
    <Card>
      <CardContent className="flex flex-col gap-6 sm:flex-row sm:items-start">
        <ScoreRing score={aiScore} />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <TallyChip count={tally.strong} label="Strong" tone="strong" />
            <TallyChip count={tally.partial} label="Partial" tone="partial" />
            <TallyChip count={tally.missing} label="Missing" tone="missing" />
            <span className="text-xs text-muted-foreground" title={formatDate(scoredAt)}>
              Scored {formatRelative(scoredAt)}
            </span>
          </div>
          {aiSummary ? (
            <p className="max-w-prose text-sm leading-relaxed text-foreground">{aiSummary}</p>
          ) : null}
        </div>
        {writer ? (
          <div className="shrink-0">
            <ScoreButton applicationId={applicationId} scored blocker={blocker} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
