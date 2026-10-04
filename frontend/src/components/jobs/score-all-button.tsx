"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { requestJobScoringAction } from "@/server/actions/scoring";
import type { JobScoringProgress, JobScoringRequestResult } from "@/server/queries/scoring";

const POLL_INTERVAL_MS = 3_000;
const MAX_POLL_FAILURES = 3;

const progressSchema = z.object({
  queued: z.number(),
  running: z.number(),
  unscored: z.number(),
});

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function describeRequest(result: JobScoringRequestResult): string {
  const parts = [`Queued ${plural(result.queued, "applicant")} for scoring.`];
  if (result.skipped > 0) {
    parts.push(`${plural(result.skipped, "applicant")} skipped — resume too short to score.`);
  }
  if (result.remaining > 0) {
    parts.push(`${result.remaining} more will need another click.`);
  }
  return parts.join(" ");
}

/**
 * Queues every unscored applicant of a job, then follows the batch to the
 * end, refreshing the ranked table as scores land. Progress comes from the
 * server, so a reload (or a teammate's open tab) picks the batch back up.
 */
export function ScoreAllButton({
  jobId,
  initialProgress,
}: {
  jobId: string;
  initialProgress: JobScoringProgress;
}) {
  const router = useRouter();
  const [progress, setProgress] = useState(initialProgress);
  const [isRequesting, startTransition] = useTransition();
  const [batchSize, setBatchSize] = useState(initialProgress.queued + initialProgress.running);

  const active = progress.queued + progress.running;
  const idleUnscored = Math.max(0, progress.unscored - active);
  // The poller starts and stops with the batch; re-subscribing on every
  // count change would reset its failure counter.
  const batchActive = active > 0;

  useEffect(() => {
    if (!batchActive) return;
    let cancelled = false;
    let failures = 0;
    let lastActive = Number.POSITIVE_INFINITY;

    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/jobs/${jobId}/scoring`, { cache: "no-store" });
        if (!response.ok) throw new Error(`status ${response.status}`);
        const next = progressSchema.parse(await response.json());
        failures = 0;
        if (cancelled) return;

        const nextActive = next.queued + next.running;
        setProgress(next);
        if (nextActive < lastActive) router.refresh();
        if (nextActive === 0) {
          toast.success("Scoring finished — the applicant ranking is up to date.");
        }
        lastActive = nextActive;
      } catch {
        failures += 1;
        if (!cancelled && failures >= MAX_POLL_FAILURES) {
          setProgress((current) => ({ ...current, queued: 0, running: 0 }));
          toast.error("We couldn't check scoring progress. Refresh the page to see the latest scores.");
        }
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [batchActive, jobId, router]);

  function handleScoreAll() {
    startTransition(async () => {
      const result = await requestJobScoringAction(jobId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const { queued, alreadyQueued } = result.data;
      if (queued === 0) {
        toast.info(
          alreadyQueued > 0
            ? "Those applicants are already being scored."
            : "Every applicant that can be scored already has a score.",
        );
        return;
      }
      toast.success(describeRequest(result.data));
      setBatchSize(queued + alreadyQueued);
      setProgress((current) => ({ ...current, queued: current.queued + queued }));
    });
  }

  if (active > 0) {
    const total = Math.max(batchSize, active);
    const done = total - active;
    return (
      <div className="flex w-full flex-col gap-2 sm:w-64" role="status" aria-live="polite">
        <div className="flex items-center gap-2 text-sm text-foreground">
          <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
          Scoring {done} of {total}…
        </div>
        <Progress value={total === 0 ? 0 : (done / total) * 100} aria-label="Scoring progress" />
      </div>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={handleScoreAll}
      disabled={isRequesting || idleUnscored === 0}
      title={idleUnscored === 0 ? "Every applicant already has a score." : undefined}
    >
      {isRequesting ? (
        <Loader2 className="animate-spin" aria-hidden="true" />
      ) : (
        <Sparkles aria-hidden="true" />
      )}
      {idleUnscored === 0 ? "All scored" : `Score all unscored (${idleUnscored})`}
    </Button>
  );
}
