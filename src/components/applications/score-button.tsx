"use client";

import { AlertCircle, Loader2, RefreshCw, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { scoreApplicationAction } from "@/server/actions/scoring";

export interface ScoreBlocker {
  message: string;
  href?: string;
  linkLabel?: string;
}

export function ScoreButton({
  applicationId,
  scored,
  blocker,
}: {
  applicationId: string;
  scored: boolean;
  blocker?: ScoreBlocker;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleScore() {
    setError(null);
    startTransition(async () => {
      const result = await scoreApplicationAction(applicationId);
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success(`Scored ${result.data.aiScore}/100.`);
      router.refresh();
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

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant={scored ? "outline" : "default"}
        onClick={handleScore}
        disabled={isPending}
      >
        {isPending ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <Sparkles aria-hidden="true" />
        )}
        {isPending ? "Scoring…" : scored ? "Rescore" : "Score with AI"}
      </Button>
      {isPending ? (
        <p role="status" className="text-xs text-muted-foreground">
          Scoring — usually takes a few seconds.
        </p>
      ) : null}
      {error && !isPending ? (
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
