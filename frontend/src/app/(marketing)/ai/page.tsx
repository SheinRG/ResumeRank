import type { Metadata } from "next";
import Link from "next/link";

import { modelCardFacts } from "@resumerank/core/model-card";

export const metadata: Metadata = {
  title: "AI model card",
  description:
    "What ResumeRank's screening model does, what it reads, how it is evaluated, its limits, and the human oversight around it.",
  alternates: { canonical: "/ai" },
};

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function Section({ id, label, title, children }: { id: string; label: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 border-t border-black/[0.08] py-12 first:border-t-0 first:pt-0">
      <div className="grid gap-6 md:grid-cols-[220px_minmax(0,1fr)]">
        <div className="flex flex-col gap-2">
          <span className="font-mono text-xs tracking-[0.08em] text-brand-ink-muted">{label}</span>
          <h2 className="font-display text-2xl font-semibold tracking-[-0.01em]">{title}</h2>
        </div>
        <div className="flex flex-col gap-4 text-[15.5px] leading-relaxed text-brand-ink-muted">{children}</div>
      </div>
    </section>
  );
}

export default function ModelCardPage() {
  const facts = modelCardFacts();
  const evaluation = facts.evaluation;
  const metrics = [
    { label: "Verdict agreement with recruiters", value: percent(evaluation.verdictAccuracy) },
    { label: "Cohen's κ", value: evaluation.verdictKappa.toFixed(2) },
    { label: "Quoted evidence found in the resume", value: percent(evaluation.evidencePrecision) },
    { label: "Mean score error (points of 100)", value: evaluation.scoreMae.toFixed(1) },
    { label: "Injection attempts flagged", value: percent(evaluation.injectionRecall) },
    { label: "Same verdict on a repeat run", value: percent(evaluation.stability) },
  ];

  return (
    <>
      <header className="px-6 pt-36 pb-20">
        <div className="mx-auto flex max-w-6xl flex-col gap-6">
          <span className="font-mono text-xs tracking-[0.08em] text-brand-muted">MODEL CARD</span>
          <h1 className="max-w-[760px] font-display text-[clamp(36px,5vw,60px)] leading-[1.05] font-bold tracking-[-0.03em]">
            The AI reads. <span className="text-brand-lime">People decide.</span>
          </h1>
          <p className="max-w-[640px] text-[17px] leading-relaxed text-brand-muted">
            What ResumeRank&apos;s screening model is for, what it reads, how well it does on a labelled test set,
            and where it falls short. Hiring AI is high-risk under the EU AI Act and covered by New York City&apos;s
            Local Law 144, so this page is written to be checked.
          </p>
          <dl className="grid max-w-3xl gap-4 font-mono text-sm sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-brand-panel p-4">
              <dt className="text-xs text-brand-muted">MODEL</dt>
              <dd className="mt-1 break-all text-brand-cream">{facts.model}</dd>
            </div>
            <div className="rounded-2xl border border-white/10 bg-brand-panel p-4">
              <dt className="text-xs text-brand-muted">PROMPT VERSION</dt>
              <dd className="mt-1 text-brand-cream">{facts.promptVersion}</dd>
            </div>
            <div className="rounded-2xl border border-white/10 bg-brand-panel p-4">
              <dt className="text-xs text-brand-muted">DECODING</dt>
              <dd className="mt-1 text-brand-cream">
                temperature {facts.temperature}, seed {facts.seed}
              </dd>
            </div>
          </dl>
        </div>
      </header>

      <div className="bg-brand-cream px-6 py-[100px] text-brand-ink">
        <div className="mx-auto max-w-6xl">
          <Section id="use" label="INTENDED USE" title="What it's for">
            <p>
              Helping recruiters read applications against a job&apos;s own requirements. For each requirement the
              model gives a verdict (strong, partial or missing evidence), quotes the passage of the resume it relied
              on, and explains itself in a sentence. Must-have requirements count twice as much as nice-to-haves,
              and the verdicts add up to a 0–100 match score.
            </p>
            <p>
              <strong className="text-brand-ink">Not for:</strong> rejecting or advancing anyone automatically,
              ranking people on anything but the listed requirements, judging personality or &quot;culture fit&quot;,
              or any decision without a person reviewing the evidence. ResumeRank has no automatic rejection.
            </p>
          </Section>

          <Section id="inputs" label="INPUTS" title="What it reads">
            <p>
              The job&apos;s title, description and requirements, and the resume text, each fenced off so that text
              inside them can&apos;t act as instructions. Nothing else: no photos, social profiles or browsing data.
              Every scoring run stores exactly what the model was given, so any score can be explained later
              however the job or resume has changed since.
            </p>
            <p>
              A workspace can hide personal details before the model reads anything: names, contact details, profile
              links, stated ages and labelled lines such as date of birth, gender, nationality or marital status.
              Skills, employers and dates stay, because experience requirements depend on them.
            </p>
          </Section>

          <Section id="evaluation" label="EVALUATION" title="How well it does">
            <p>
              Measured on a versioned golden set (version {evaluation.datasetVersion}) of resume and requirement pairs
              that two careful recruiters would label the same way. It includes too-few-years cases, unrelated
              careers, PDF extraction damage and prompt-injection attempts. These are the committed results for{" "}
              <span className="font-mono text-brand-ink">{evaluation.model}</span> with prompt{" "}
              <span className="font-mono text-brand-ink">{evaluation.promptVersion}</span> over{" "}
              {evaluation.judgments} judgments:
            </p>
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {metrics.map((metric) => (
                <div key={metric.label} className="rounded-2xl border border-black/[0.06] bg-white p-5">
                  <dt className="text-sm">{metric.label}</dt>
                  <dd className="mt-1 font-mono text-2xl font-semibold text-brand-ink">{metric.value}</dd>
                </div>
              ))}
            </dl>
            <p>
              Any change to the prompt, the scoring engine or the model has to be re-measured against this set
              before it ships, and a drop in agreement fails the build.
            </p>
          </Section>

          <Section id="limits" label="LIMITATIONS" title="Where it falls short">
            <ul className="flex list-disc flex-col gap-2 pl-5">
              <li>
                Its most common mistake is calling partial evidence missing: it is strict about what a resume
                actually says, so experience that is implied but not written down scores lower.
              </li>
              <li>
                It judges only the text. A resume that undersells someone, or a requirement worded vaguely,
                produces a weaker score; the quoted evidence makes both visible.
              </li>
              <li>
                The golden set is small and written in English. Performance on other languages, unusual formats
                and roles far from the test set is not measured.
              </li>
              <li>
                Hiding personal details removes direct signals, not every proxy: school names, locations and
                gaps in employment can still correlate with protected characteristics.
              </li>
              <li>
                Wording of notes can vary between runs; verdicts on identical inputs are much more stable (see
                above).
              </li>
            </ul>
          </Section>

          <Section id="oversight" label="HUMAN OVERSIGHT" title="Who stays in charge">
            <p>
              Every stage change is made by a person and recorded with what the AI had shown them at that moment:
              the score, the run and the model behind it, sealed into a tamper-evident audit log. Interviewers
              don&apos;t see AI scores at all, so they can&apos;t anchor on them.
            </p>
            <p>
              Candidates are told how AI is used and can opt out; an opted-out candidate is never scored. Admins
              can run selection-rate and impact-ratio reports by sex and race/ethnicity from voluntary
              self-identification, the format New York City bias audits use. Those answers are never shown next
              to an application and never reach the model.
            </p>
          </Section>

          <Section id="data" label="DATA" title="Where the text goes">
            <p>
              Scoring runs on Groq{facts.fallbackModel ? `, falling back to ${facts.fallbackModel} if the main model is unavailable` : ""}.
              Only the job and the resume being scored are sent, for that request. ResumeRank doesn&apos;t train
              models on customer data. The full list of sub-processors is on the{" "}
              <Link href="/security#sub-processors" className="font-medium text-brand-ink underline underline-offset-4">
                security page
              </Link>
              .
            </p>
          </Section>
        </div>
      </div>
    </>
  );
}
