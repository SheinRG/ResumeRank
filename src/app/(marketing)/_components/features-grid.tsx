import {
  ChartColumn,
  History,
  ListChecks,
  Sparkles,
  UsersRound,
  Workflow,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const FEATURES: Array<{ icon: LucideIcon; title: string; body: string }> = [
  {
    icon: Sparkles,
    title: "AI scoring with evidence",
    body: "Groq scores each application against the job's requirements and quotes the resume line that backs up every verdict.",
  },
  {
    icon: ListChecks,
    title: "Requirement rubrics",
    body: "Define must-have and nice-to-have requirements per job, so scoring has an explicit, reviewable rubric.",
  },
  {
    icon: Workflow,
    title: "Pipeline stages",
    body: "Track every application from new to hired with stage transitions your whole team can see.",
  },
  {
    icon: UsersRound,
    title: "Team scorecards",
    body: "Teammates leave a 1–5 rating and notes alongside the AI's evaluation, so human judgment stays in the loop.",
  },
  {
    icon: History,
    title: "Activity audit log",
    body: "Every create, edit, and stage change is recorded in an append-only log you can filter by entity.",
  },
  {
    icon: ChartColumn,
    title: "Dashboard analytics",
    body: "See pipeline health, score distribution, and application volume over time at a glance.",
  },
];

export function FeaturesGrid() {
  return (
    <section id="features" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-semibold tracking-tight text-foreground">
          Everything a screening pipeline needs
        </h2>
        <p className="mt-3 text-base text-muted-foreground">
          Built around one idea: a score is only useful if you can see why it
          was given.
        </p>
      </div>

      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, body }) => (
          <Card key={title} className="gap-3">
            <CardHeader>
              <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="size-5" aria-hidden="true" />
              </div>
              <CardTitle className="mt-2 text-base">{title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {body}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
