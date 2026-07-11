import { Quote, Scale, Workflow } from "lucide-react";
import type { LucideIcon } from "lucide-react";

const VALUE_PROPS: Array<{ icon: LucideIcon; title: string; body: string }> = [
  {
    icon: Quote,
    title: "Explainable verdicts",
    body: "Every verdict comes with a verbatim quote from the resume, not a mystery number.",
  },
  {
    icon: Scale,
    title: "Weighted scoring",
    body: "Must-have requirements count twice as much as nice-to-haves, so the score reflects what matters.",
  },
  {
    icon: Workflow,
    title: "Pipeline built in",
    body: "Move candidates through new, screening, shortlisted, interview, offer, and hired in one place.",
  },
];

export function ValueProps() {
  return (
    <div className="border-y border-border bg-secondary/40">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 sm:grid-cols-3 sm:px-6">
        {VALUE_PROPS.map(({ icon: Icon, title, body }) => (
          <div key={title} className="flex flex-col gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon className="size-5" aria-hidden="true" />
            </div>
            <h3 className="text-base font-semibold text-foreground">
              {title}
            </h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {body}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
