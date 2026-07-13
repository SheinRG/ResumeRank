const STEPS = [
  {
    title: "Create a job with requirements",
    body: "Write the role, then list what actually matters — mark each requirement must-have or nice-to-have.",
  },
  {
    title: "Paste candidate resumes",
    body: "Add candidates by pasting resume text. No file-upload pipeline required to start screening.",
  },
  {
    title: "Score and shortlist with evidence",
    body: "Run AI scoring and get a weighted score plus a verdict, evidence quote, and note for every requirement.",
  },
];

export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="border-y border-border bg-secondary/40"
    >
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground">
            How it works
          </h2>
          <p className="mt-3 text-base text-muted-foreground">
            Three steps between a pile of resumes and a defensible shortlist.
          </p>
        </div>

        <ol className="mt-12 grid gap-8 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex flex-col gap-3">
              <span className="flex size-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                {index + 1}
              </span>
              <h3 className="text-base font-semibold text-foreground">
                {step.title}
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {step.body}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
