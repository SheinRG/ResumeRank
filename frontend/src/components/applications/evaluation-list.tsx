import { ListChecks } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { VerdictBadge } from "@/components/shared/status-badges";
import { cn } from "@/lib/utils";
import type { EvaluationItem } from "@/server/queries/applications";

export function EvaluationList({
  evaluations,
  scored,
}: {
  evaluations: EvaluationItem[];
  scored: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Requirement breakdown</CardTitle>
        <CardDescription>
          Every requirement judged against the resume, with quoted evidence.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {evaluations.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title={scored ? "Score exists but the breakdown is missing" : "No breakdown yet"}
            description={
              scored
                ? "Rescore to regenerate the per-requirement evaluations."
                : "Run AI scoring to see a verdict and evidence for each requirement."
            }
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {evaluations.map((evaluation) => (
              <li
                key={evaluation.id}
                className={cn(
                  "flex flex-col gap-2 rounded-lg border border-border border-l-4 p-4",
                  evaluation.verdict === "MISSING"
                    ? "border-l-rose-400 dark:border-l-rose-600"
                    : evaluation.verdict === "PARTIAL"
                      ? "border-l-amber-400 dark:border-l-amber-600"
                      : "border-l-emerald-400 dark:border-l-emerald-600",
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 flex-1 font-medium text-foreground">
                    {evaluation.criterion}
                  </p>
                  <Badge variant="outline">
                    {evaluation.weight === "MUST" ? "Must-have" : "Nice-to-have"}
                  </Badge>
                  <VerdictBadge verdict={evaluation.verdict} />
                </div>
                {evaluation.evidence ? (
                  <blockquote className="border-l-2 border-border pl-3 text-sm italic leading-relaxed text-muted-foreground">
                    &ldquo;{evaluation.evidence}&rdquo;
                  </blockquote>
                ) : null}
                <p className="text-sm leading-relaxed text-foreground">{evaluation.note}</p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
