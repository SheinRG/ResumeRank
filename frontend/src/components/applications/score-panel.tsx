import { ShieldAlert, Sparkles } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import {
  ScoreButton,
  type ScoreBlocker,
  type TrackedRun,
} from "@/components/applications/score-button";
import { formatDate, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  ApplicationScoring,
  EvaluationItem,
  ScoringHistoryItem,
} from "@/server/queries/applications";

function ringClasses(score: number): { stroke: string; text: string } {
  if (score >= 70) {
    return { stroke: "stroke-verdict-strong", text: "text-verdict-strong" };
  }
  if (score >= 40) {
    return { stroke: "stroke-verdict-partial", text: "text-verdict-partial" };
  }
  return { stroke: "stroke-verdict-missing", text: "text-verdict-missing" };
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
  strong: "border border-verdict-strong/30 bg-verdict-strong/10 text-verdict-strong",
  partial: "border border-verdict-partial/30 bg-verdict-partial/10 text-verdict-partial",
  missing: "border border-verdict-missing/30 bg-verdict-missing/10 text-verdict-missing",
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

const INJECTION_SIGNALS: Record<string, string> = {
  "ignore-instructions": "asks the AI to ignore its instructions",
  "role-override": "tries to give the AI a new role",
  "role-marker": "contains fake system or assistant messages",
  "score-steering": "asks for a particular score",
  "output-forgery": "contains text shaped like the AI's answer",
  delimiter: "contains the markers that fence off the resume",
  "hidden-text": "contains invisible characters",
};

/**
 * The resume is fenced off as data and the score is not adjusted, but text
 * written to steer the AI is worth a human look before trusting the result.
 */
function InjectionWarning({ signals }: { signals: string[] }) {
  return (
    <div
      role="note"
      className="flex items-start gap-2 rounded-lg border border-verdict-partial/40 bg-verdict-partial/10 p-3 text-sm"
    >
      <ShieldAlert className="mt-0.5 size-4 shrink-0 text-verdict-partial" aria-hidden="true" />
      <div className="flex flex-col gap-1">
        <p className="font-medium text-foreground">This resume may be trying to influence the AI</p>
        <p className="text-muted-foreground">
          It {signals.map((signal) => INJECTION_SIGNALS[signal] ?? signal).join("; ")}. Check the
          quoted evidence against the resume before relying on this score.
        </p>
      </div>
    </div>
  );
}

/** Every successful run is kept, so a rescore never erases the score a decision was based on. */
function ScoreHistory({ history }: { history: ScoringHistoryItem[] }) {
  const scores = history.flatMap((run) => (run.aiScore === null ? [] : [run.aiScore]));
  const low = Math.min(...scores);
  const high = Math.max(...scores);
  return (
    <div className="flex flex-col gap-1.5 border-t border-border pt-3">
      <p className="flex flex-wrap items-baseline gap-x-2 font-mono text-xs uppercase tracking-wide text-muted-foreground">
        Score history
        {scores.length > 1 && high > low ? (
          <span className="normal-case tracking-normal">
            ranged {low}–{high} across {scores.length} runs
          </span>
        ) : null}
      </p>
      <ol className="flex flex-col gap-1">
        {history.map((run) => (
          <li key={run.id} className="flex flex-wrap items-baseline gap-x-2 text-xs">
            <span className="font-mono font-semibold tabular-nums text-foreground">
              {run.aiScore ?? "—"}
            </span>
            {run.finishedAt ? (
              <span className="text-muted-foreground" title={formatDate(run.finishedAt)}>
                {formatRelative(run.finishedAt)}
              </span>
            ) : null}
            <span className="font-mono text-muted-foreground">{run.model}</span>
            {run.current ? (
              <span className="rounded-sm bg-accent/30 px-1.5 font-medium text-foreground">
                current
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

function trackedRun(scoring: ApplicationScoring): TrackedRun | null {
  const { active } = scoring;
  if (active && (active.status === "QUEUED" || active.status === "RUNNING")) {
    return { id: active.id, status: active.status };
  }
  return null;
}

export function ScorePanel({
  applicationId,
  aiScore,
  aiSummary,
  scoredAt,
  evaluations,
  scoring,
  writer,
  blocker,
}: {
  applicationId: string;
  aiScore: number | null;
  aiSummary: string | null;
  scoredAt: Date | null;
  evaluations: EvaluationItem[];
  scoring: ApplicationScoring;
  writer: boolean;
  blocker?: ScoreBlocker;
}) {
  const activeRun = trackedRun(scoring);
  const lastFailure = scoring.lastFailure?.error ?? null;

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
            <ScoreButton
              applicationId={applicationId}
              scored={false}
              blocker={blocker}
              activeRun={activeRun}
              lastFailure={lastFailure}
            />
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
          {scoring.injectionSignals.length > 0 ? (
            <InjectionWarning signals={scoring.injectionSignals} />
          ) : null}
          {scoring.history.length > 1 ? <ScoreHistory history={scoring.history} /> : null}
        </div>
        {writer ? (
          <div className="shrink-0">
            <ScoreButton
              applicationId={applicationId}
              scored
              blocker={blocker}
              activeRun={activeRun}
              lastFailure={lastFailure}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
