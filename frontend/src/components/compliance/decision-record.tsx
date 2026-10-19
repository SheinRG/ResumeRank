import { ArrowRight, History } from "lucide-react";

import { DateText } from "@/components/format/format-provider";
import { EmptyState } from "@/components/shared/empty-state";
import { STAGE_LABELS } from "@/components/shared/status-badges";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { DecisionAi, StageDecision } from "@resumerank/core/services/decisions";

function AiContext({ ai }: { ai: DecisionAi }) {
  switch (ai.kind) {
    case "shown":
      return (
        <span>
          AI score at the time:{" "}
          <span className="font-mono text-foreground">{ai.score ?? "—"}</span>
          <span className="font-mono text-xs">
            {" "}
            · {ai.model} · prompt {ai.promptVersion}
            {ai.scoredAt ? (
              <>
                {" "}
                · scored <DateText value={ai.scoredAt} />
              </>
            ) : null}
          </span>
        </span>
      );
    case "unscored":
      return <span>No AI score yet when this was decided.</span>;
    case "hidden":
      return <span>Decided without AI scores in view.</span>;
    case "unrecorded":
      return <span>Recorded before decisions kept the AI context.</span>;
  }
}

export function DecisionRecord({ decisions }: { decisions: StageDecision[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Decision record</CardTitle>
        <CardDescription>
          Every stage change, who made it, and what the AI had shown them at that moment. People make the
          decisions; this is the record that they did.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {decisions.length === 0 ? (
          <EmptyState
            icon={History}
            title="No decisions yet"
            description="Moving this application to another stage records the decision here."
          />
        ) : (
          <ol className="flex flex-col divide-y divide-border">
            {decisions.map((decision) => (
              <li key={decision.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <span className="font-medium text-foreground">{decision.actor?.name ?? "A former teammate"}</span>
                  <span className="text-muted-foreground">moved it</span>
                  {decision.from ? (
                    <>
                      <span className="text-muted-foreground">{STAGE_LABELS[decision.from]}</span>
                      <ArrowRight className="size-3.5 text-muted-foreground" aria-label="to" />
                    </>
                  ) : (
                    <span className="text-muted-foreground">to</span>
                  )}
                  <span className="font-medium text-foreground">{STAGE_LABELS[decision.to]}</span>
                  <span className="ml-auto font-mono text-xs text-muted-foreground"><DateText value={decision.at} /></span>
                </div>
                <p className="text-sm text-muted-foreground">
                  <AiContext ai={decision.ai} />
                </p>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
