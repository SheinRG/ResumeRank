import { ClipboardList } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { EmptyState } from "@/components/shared/empty-state";
import { ScorecardForm } from "@/components/applications/scorecard-form";
import { StarDisplay } from "@/components/applications/star-display";
import { formatDate } from "@/lib/format";
import type { ScorecardItem } from "@/server/queries/applications";

export function ScorecardsPanel({
  applicationId,
  scorecards,
  currentUserId,
  writer,
}: {
  applicationId: string;
  scorecards: ScorecardItem[];
  currentUserId: string;
  writer: boolean;
}) {
  const own = scorecards.find((scorecard) => scorecard.reviewer.id === currentUserId) ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Scorecards</CardTitle>
        <CardDescription>Human judgment beside the AI&apos;s.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {scorecards.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="No scorecards yet"
            description={
              writer
                ? "Be the first to rate this application."
                : "Ratings your team leaves will show up here."
            }
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {scorecards.map((scorecard) => (
              <li key={scorecard.id} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-foreground">
                    {scorecard.reviewer.name}
                    {scorecard.reviewer.id === currentUserId ? (
                      <span className="text-muted-foreground"> (you)</span>
                    ) : null}
                  </span>
                  <div className="flex items-center gap-3">
                    <StarDisplay rating={scorecard.rating} />
                    <span className="text-xs text-muted-foreground">
                      {formatDate(scorecard.createdAt)}
                    </span>
                  </div>
                </div>
                {scorecard.notes ? (
                  <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
                    {scorecard.notes}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {writer ? (
          <>
            <Separator />
            <div className="flex flex-col gap-3">
              <p className="text-sm font-medium text-foreground">Your scorecard</p>
              <ScorecardForm
                applicationId={applicationId}
                existing={own ? { rating: own.rating, notes: own.notes } : null}
              />
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
