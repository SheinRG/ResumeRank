import { Quote } from "lucide-react";

import { Card } from "@/components/ui/card";
import { VerdictBadge } from "@/components/shared/status-badges";

const SCORE = 82;
const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const OFFSET = CIRCUMFERENCE * (1 - SCORE / 100);

const ROWS: Array<{
  label: string;
  verdict: "STRONG" | "PARTIAL" | "MISSING";
  detail: string;
}> = [
  {
    label: "5+ years production React experience",
    verdict: "STRONG",
    detail: "“6 years building and shipping production React apps at scale.”",
  },
  {
    label: "Has led or mentored a team",
    verdict: "PARTIAL",
    detail: "“Mentored two junior engineers informally.”",
  },
  {
    label: "AWS or cloud infra certification",
    verdict: "MISSING",
    detail: "No certification or cloud infra experience mentioned.",
  },
];

/**
 * Static, hand-built product mock — not a screenshot. Mirrors the real
 * report view's shape (score ring, per-requirement verdict, quoted
 * evidence) using the same VerdictBadge component used in the app.
 */
export function ReportCardMock() {
  return (
    <Card className="w-full max-w-md gap-5 p-6 shadow-lg">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-foreground">
            Priya Malhotra
          </p>
          <p className="text-xs text-muted-foreground">
            Senior Frontend Engineer
          </p>
        </div>

        <div className="relative flex size-16 shrink-0 items-center justify-center">
          <svg
            viewBox="0 0 120 120"
            className="size-16 -rotate-90"
            aria-hidden="true"
          >
            <circle
              cx="60"
              cy="60"
              r={RADIUS}
              fill="none"
              strokeWidth="10"
              className="stroke-muted"
            />
            <circle
              cx="60"
              cy="60"
              r={RADIUS}
              fill="none"
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={OFFSET}
              className="stroke-emerald-500 dark:stroke-emerald-400"
            />
          </svg>
          <span className="absolute text-lg font-semibold tabular-nums text-foreground">
            {SCORE}
          </span>
        </div>
      </div>

      <ul className="flex flex-col gap-3">
        {ROWS.map((row) => (
          <li
            key={row.label}
            className="flex flex-col gap-1.5 rounded-lg border border-border bg-card px-3 py-2.5"
          >
            <div className="flex items-start justify-between gap-3">
              <span className="text-sm font-medium text-foreground">
                {row.label}
              </span>
              <VerdictBadge verdict={row.verdict} className="shrink-0" />
            </div>
            <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Quote className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
              <span>{row.detail}</span>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
