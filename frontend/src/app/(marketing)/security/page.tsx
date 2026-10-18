import { ArrowUpRight, Check } from "lucide-react";
import type { Metadata } from "next";

import { activeSubProcessors } from "@resumerank/core/sub-processors";
import { REPOSITORY_URL, VULNERABILITY_REPORT_URL } from "@/lib/site";
import { cn } from "@/lib/utils";

import { CONTROL_GROUPS, PROGRAM, STATUS_LABELS, type ProgramStatus } from "./security-data";

export const metadata: Metadata = {
  title: "Security",
  description:
    "How ResumeRank protects your hiring data: tenant isolation, SSO and two-factor sign-in, a tamper-evident audit log, sub-processors, and how to report a vulnerability.",
  alternates: { canonical: "/security" },
};

const STATUS_STYLES: Record<ProgramStatus, string> = {
  "in-place": "bg-brand-lime text-brand-night",
  "in-progress": "border border-brand-lime/60 text-brand-lime",
  planned: "border border-white/20 text-brand-muted",
};

const SECTION_LINKS = [
  { href: "#controls", label: "Controls" },
  { href: "#program", label: "Compliance" },
  { href: "#sub-processors", label: "Sub-processors" },
  { href: "#disclosure", label: "Report a vulnerability" },
];

function SectionLabel({ children, tone }: { children: string; tone: "light" | "dark" }) {
  return (
    <span
      className={cn(
        "font-mono text-xs tracking-[0.08em]",
        tone === "light" ? "text-brand-ink-muted" : "text-brand-muted",
      )}
    >
      {children}
    </span>
  );
}

function SubProcessorTable() {
  const rows = activeSubProcessors();

  if (rows.length === 0) {
    return (
      <p className="rounded-2xl border border-white/10 bg-brand-panel p-6 text-[15px] leading-relaxed text-brand-muted">
        This installation doesn&apos;t send customer data to any third-party service. Its operator hosts
        the database, files and email themselves.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-white/10 bg-brand-panel">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="border-b border-white/10 font-mono text-xs tracking-[0.06em] text-brand-muted">
            <th scope="col" className="px-5 py-3.5 font-normal">PROVIDER</th>
            <th scope="col" className="px-5 py-3.5 font-normal">PURPOSE</th>
            <th scope="col" className="px-5 py-3.5 font-normal">DATA</th>
            <th scope="col" className="px-5 py-3.5 font-normal">WHEN</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name} className="border-b border-white/[0.06] last:border-0">
              <th scope="row" className="px-5 py-4 font-display font-semibold text-brand-cream">
                {row.name}
              </th>
              <td className="px-5 py-4 text-brand-muted">{row.purpose}</td>
              <td className="px-5 py-4 text-brand-muted">{row.data}</td>
              <td className="px-5 py-4 text-brand-muted">{row.when}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SecurityPage() {
  return (
    <>
      <header className="relative overflow-clip px-6 pt-36 pb-24">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-40 -right-32 size-[560px] rounded-full"
          style={{
            background: "radial-gradient(circle,rgba(198,242,78,0.14) 0%,rgba(198,242,78,0) 62%)",
          }}
        />
        <div className="relative mx-auto flex max-w-6xl flex-col gap-7">
          <SectionLabel tone="dark">TRUST CENTER</SectionLabel>
          <h1 className="max-w-[760px] font-display text-[clamp(36px,5vw,64px)] leading-[1.05] font-bold tracking-[-0.03em]">
            Your candidates trusted you with their data.{" "}
            <span className="text-brand-lime">Here&apos;s how we keep it.</span>
          </h1>
          <p className="max-w-[640px] text-[17px] leading-relaxed text-brand-muted">
            ResumeRank is open source, so every control on this page can be read in the code. This page
            describes this deployment. A self-hosted install gets the same application controls, and its
            operator runs the infrastructure.
          </p>
          <nav aria-label="On this page" className="flex flex-wrap gap-2.5">
            {SECTION_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="inline-flex min-h-11 items-center rounded-full border border-white/15 px-4 text-sm font-medium text-brand-cream transition-colors hover:border-brand-lime hover:text-brand-lime"
              >
                {link.label}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <section id="controls" className="scroll-mt-20 bg-brand-cream px-6 py-[110px] text-brand-ink">
        <div className="mx-auto max-w-6xl">
          <div className="mb-14 max-w-[640px]">
            <SectionLabel tone="light">CONTROLS</SectionLabel>
            <h2 className="mt-3.5 font-display text-[clamp(28px,3.2vw,44px)] leading-[1.1] font-bold tracking-[-0.02em]">
              What protects your workspace today.
            </h2>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            {CONTROL_GROUPS.map((group) => (
              <article
                key={group.id}
                id={group.id}
                className="flex scroll-mt-20 flex-col gap-4 rounded-2xl border border-black/[0.06] bg-white p-7 sm:p-8"
              >
                <div className="flex flex-col gap-1.5">
                  <h3 className="font-display text-[21px] font-semibold tracking-[-0.01em]">{group.title}</h3>
                  <p className="text-[15px] text-brand-ink-muted">{group.summary}</p>
                </div>
                <ul className="flex flex-col gap-3">
                  {group.points.map((point) => (
                    <li key={point} className="flex gap-3 text-[14.5px] leading-relaxed text-brand-ink-muted">
                      <Check
                        aria-hidden="true"
                        className="mt-1 size-4 shrink-0 rounded-full bg-brand-ink p-0.5 text-brand-lime"
                      />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="program" className="scroll-mt-20 px-6 py-[110px]">
        <div className="mx-auto flex max-w-6xl flex-col gap-24">
          <div>
            <div className="mb-12 max-w-[640px]">
              <SectionLabel tone="dark">COMPLIANCE</SectionLabel>
              <h2 className="mt-3.5 font-display text-[clamp(28px,3.2vw,44px)] leading-[1.1] font-bold tracking-[-0.02em]">
                Where we are, stated plainly.
              </h2>
              <p className="mt-4 text-[15.5px] leading-relaxed text-brand-muted">
                We list certifications only once we hold them. Until then, this is the honest status.
              </p>
            </div>
            <ul className="grid gap-4 sm:grid-cols-2">
              {PROGRAM.map((item) => (
                <li
                  key={item.title}
                  className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-brand-panel p-6"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="font-display text-lg font-semibold">{item.title}</h3>
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-1 font-mono text-[11px] tracking-[0.06em] uppercase",
                        STATUS_STYLES[item.status],
                      )}
                    >
                      {STATUS_LABELS[item.status]}
                    </span>
                  </div>
                  <p className="text-[14.5px] leading-relaxed text-brand-muted">{item.body}</p>
                </li>
              ))}
            </ul>
          </div>

          <div id="sub-processors" className="scroll-mt-20">
            <div className="mb-10 max-w-[640px]">
              <SectionLabel tone="dark">SUB-PROCESSORS</SectionLabel>
              <h2 className="mt-3.5 font-display text-[clamp(28px,3.2vw,44px)] leading-[1.1] font-bold tracking-[-0.02em]">
                Who else touches your data.
              </h2>
              <p className="mt-4 text-[15.5px] leading-relaxed text-brand-muted">
                Generated from this deployment&apos;s configuration, so it lists exactly the services it
                is connected to. We announce a new sub-processor here before it receives any data.
              </p>
            </div>
            <SubProcessorTable />
          </div>
        </div>
      </section>

      <section id="disclosure" className="scroll-mt-20 bg-brand-cream px-6 py-[110px] text-brand-ink">
        <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[1.1fr_1fr]">
          <div className="flex flex-col gap-5">
            <SectionLabel tone="light">VULNERABILITY DISCLOSURE</SectionLabel>
            <h2 className="font-display text-[clamp(28px,3.2vw,44px)] leading-[1.1] font-bold tracking-[-0.02em]">
              Found something? Tell us first.
            </h2>
            <p className="text-[15.5px] leading-relaxed text-brand-ink-muted">
              Report it privately through GitHub&apos;s security advisory form, not a public issue. We
              acknowledge every report within three business days and keep you posted until it&apos;s fixed.
              Research done in good faith under our policy is welcome, and we won&apos;t pursue legal action
              over it.
            </p>
            <div className="flex flex-wrap gap-3">
              <a
                href={VULNERABILITY_REPORT_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center gap-2 rounded-full bg-brand-ink px-5 text-sm font-semibold text-brand-cream transition-opacity hover:opacity-90"
              >
                Report a vulnerability
                <ArrowUpRight aria-hidden="true" className="size-4" />
              </a>
              <a
                href={`${REPOSITORY_URL}/blob/main/SECURITY.md`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-black/15 px-5 text-sm font-semibold transition-colors hover:border-brand-ink"
              >
                Read the full policy
                <ArrowUpRight aria-hidden="true" className="size-4" />
              </a>
            </div>
          </div>
          <dl className="grid gap-4 self-start rounded-2xl border border-black/[0.06] bg-white p-7 text-[14.5px] sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <dt className="font-mono text-xs tracking-[0.06em] text-brand-ink-muted">IN SCOPE</dt>
              <dd className="leading-relaxed">This app, its public API, and the open-source code.</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="font-mono text-xs tracking-[0.06em] text-brand-ink-muted">OUT OF SCOPE</dt>
              <dd className="leading-relaxed">Denial of service, social engineering, and other people&apos;s data.</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="font-mono text-xs tracking-[0.06em] text-brand-ink-muted">ACKNOWLEDGEMENT</dt>
              <dd className="leading-relaxed">Within 3 business days.</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="font-mono text-xs tracking-[0.06em] text-brand-ink-muted">MACHINE-READABLE</dt>
              <dd className="leading-relaxed">
                <a href="/.well-known/security.txt" className="underline underline-offset-4">
                  security.txt
                </a>
              </dd>
            </div>
          </dl>
        </div>
      </section>
    </>
  );
}
