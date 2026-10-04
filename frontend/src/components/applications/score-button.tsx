"use client";

import { AlertCircle, Loader2, RefreshCw, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { scoringRunStatusSchema } from "@resumerank/core/validators/enums";
import { requestScoringAction } from "@/server/actions/scoring";

export interface ScoreBlocker {
  message: string;
  href?: string;
  linkLabel?: string;
}

export interface TrackedRun {
  id: string;
  status: "QUEUED" | "RUNNING";
}

const POLL_INTERVAL_MS = 2_000;
const MAX_POLL_FAILURES = 3;

const runSnapshotSchema = z.object({
  status: scoringRunStatusSchema,
  aiScore: z.number().nullable(),
  error: z.string().nullable(),
});

export function ScoreButton({
  applicationId,
  scored,
  blocker,
  activeRun,
  lastFailure,
}: {
  applicationId: string;
  scored: boolean;
  blocker?: ScoreBlocker;
  /** A run already in flight when the page rendered; polling resumes on it. */
  activeRun?: TrackedRun | null;
  lastFailure?: string | null;
}) {
  const router = useRouter();
  const [tracked, setTracked] = useState<TrackedRun | null>(activeRun ?? null);
  const [error, setError] = useState<string | null>(activeRun ? null : (lastFailure ?? null));
  const [isRequesting, startTransition] = useTransition();
  const trackedId = tracked?.id;

  useEffect(() => {
    if (!trackedId) return;
    let cancelled = false;
    let failures = 0;

    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/scoring/runs/${trackedId}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`status ${response.status}`);
        const run = runSnapshotSchema.parse(await response.json());
        failures = 0;
        if (cancelled) return;

        if (run.status === "SUCCEEDED") {
          setTracked(null);
          toast.success(`Scored ${run.aiScore ?? 0}/100.`);
          router.refresh();
        } else if (run.status === "FAILED") {
          const message = run.error ?? "Scoring failed. Try again.";
          setTracked(null);
          setError(message);
          toast.error(message);
          router.refresh();
        } else {
          const status = run.status;
          setTracked((current) => (current && current.status !== status ? { ...current, status } : current));
        }
      } catch {
        failures += 1;
        if (!cancelled && failures >= MAX_POLL_FAILURES) {
          setTracked(null);
          setError("We couldn't check on this score. Refresh the page to see the latest result.");
        }
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [trackedId, router]);

  function handleScore() {
    setError(null);
    startTransition(async () => {
      const result = await requestScoringAction(applicationId);
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      const { outcome, run } = result.data;
      if (outcome === "reused") {
        toast.success("Already up to date — nothing changed since this exact resume and rubric were scored.");
        router.refresh();
        return;
      }
      if (run.status === "QUEUED" || run.status === "RUNNING") {
        setTracked({ id: run.id, status: run.status });
      }
    });
  }

  if (blocker) {
    return (
      <div className="flex flex-col gap-2">
        <Button type="button" disabled variant={scored ? "outline" : "default"}>
          <Sparkles aria-hidden="true" />
          {scored ? "Rescore" : "Score with AI"}
        </Button>
        <p className="max-w-56 text-xs text-muted-foreground">
          {blocker.message}
          {blocker.href ? (
            <>
              {" "}
              <Link
                href={blocker.href}
                className="font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:rounded-sm"
              >
                {blocker.linkLabel ?? "Fix it"}
              </Link>
            </>
          ) : null}
        </p>
      </div>
    );
  }

  const busy = isRequesting || tracked !== null;
  const label = isRequesting
    ? "Queuing…"
    : tracked?.status === "RUNNING"
      ? "Scoring…"
      : tracked
        ? "Queued…"
        : scored
          ? "Rescore"
          : "Score with AI";

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant={scored ? "outline" : "default"}
        onClick={handleScore}
        disabled={busy}
      >
        {busy ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <Sparkles aria-hidden="true" />
        )}
        {label}
      </Button>
      <p role="status" aria-live="polite" className="max-w-56 text-xs text-muted-foreground">
        {tracked?.status === "RUNNING"
          ? "Scoring — usually takes a few seconds."
          : tracked
            ? "Waiting for a free scoring slot. You can leave this page; it keeps going."
            : null}
      </p>
      {error && !busy ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2"
        >
          <AlertCircle
            className="mt-0.5 size-4 shrink-0 text-destructive"
            aria-hidden="true"
          />
          <div className="flex flex-col items-start gap-2">
            <p className="text-xs text-destructive">{error}</p>
            <Button type="button" variant="outline" size="sm" onClick={handleScore}>
              <RefreshCw aria-hidden="true" />
              Retry
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
