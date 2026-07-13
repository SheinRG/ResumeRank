const STEPS = [
  {
    n: "01",
    title: "Create a job with requirements",
    body: "Write the role, then list what actually matters — mark each requirement must-have or nice-to-have.",
  },
  {
    n: "02",
    title: "Paste candidate resumes",
    body: "Add candidates by pasting resume text. No file-upload pipeline required to start screening.",
  },
  {
    n: "03",
    title: "Score and shortlist with evidence",
    body: "Run AI scoring and get a weighted score plus a verdict, evidence quote, and note for every requirement.",
  },
];

const REPORT = [
  {
    label: "5+ years production React",
    verdict: "STRONG",
    evidence: "“6 years building and shipping production React apps at scale.”",
    fg: "text-[#15803d]",
    ring: "border-[#15803d]/30 bg-[#15803d]/[0.06]",
  },
  {
    label: "Has led or mentored a team",
    verdict: "PARTIAL",
    evidence: "“Mentored two junior engineers informally.”",
    fg: "text-[#b45309]",
    ring: "border-[#b45309]/30 bg-[#b45309]/[0.06]",
  },
  {
    label: "AWS or cloud certification",
    verdict: "MISSING",
    evidence: "No certification or cloud infra experience mentioned.",
    fg: "text-[#be123c]",
    ring: "border-[#be123c]/30 bg-[#be123c]/[0.06]",
  },
];

function Panel1() {
  return (
    <div
      data-demo-panel
      className="absolute inset-0 flex flex-col gap-4 rounded-[20px] border border-black/10 bg-white p-7 shadow-[0_30px_70px_rgba(22,26,33,0.12)]"
    >
      <span className="font-display text-base font-semibold">
        Senior Frontend Engineer
      </span>
      <div className="h-px bg-black/[0.07]" />
      <span className="font-mono text-[11px] tracking-[0.06em] text-[#9ba1ac]">
        REQUIREMENTS
      </span>
      <div className="flex flex-col gap-2.5">
        {[
          { t: "5+ years production React experience", must: true },
          { t: "Has led or mentored a team", must: true },
          { t: "AWS or cloud infra certification", must: false },
        ].map((r) => (
          <div
            key={r.t}
            className="flex items-center justify-between rounded-xl border border-black/[0.09] px-4 py-3.5"
          >
            <span className="text-sm font-medium">{r.t}</span>
            {r.must ? (
              <span className="rounded-full bg-brand-ink px-2.5 py-1 font-mono text-[10px] tracking-[0.04em] text-brand-cream">
                MUST-HAVE
              </span>
            ) : (
              <span className="rounded-full border border-black/20 px-2.5 py-[3px] font-mono text-[10px] tracking-[0.04em] text-[#59606c]">
                NICE-TO-HAVE
              </span>
            )}
          </div>
        ))}
        <div className="flex items-center rounded-xl border border-dashed border-black/[0.18] px-4 py-3.5 text-sm text-[#9ba1ac]">
          + Add requirement
        </div>
      </div>
    </div>
  );
}

function Panel2() {
  return (
    <div
      data-demo-panel
      className="absolute inset-0 flex flex-col gap-4 rounded-[20px] border border-black/10 bg-white p-7 opacity-0 shadow-[0_30px_70px_rgba(22,26,33,0.12)]"
    >
      <div className="flex items-center justify-between">
        <span className="font-display text-base font-semibold">
          Add candidate
        </span>
        <span className="flex items-center gap-2">
          <span className="flex size-[26px] items-center justify-center rounded-full bg-[#e8e4d8] text-[11px] font-semibold text-[#59606c]">
            PM
          </span>
          <span className="text-[13px] font-medium">Priya Malhotra</span>
        </span>
      </div>
      <div className="h-px bg-black/[0.07]" />
      <span className="font-mono text-[11px] tracking-[0.06em] text-[#9ba1ac]">
        RESUME TEXT · PASTED
      </span>
      <div className="flex-1 overflow-hidden rounded-xl border border-black/[0.09] bg-[#fbfaf6] p-[18px] font-mono text-[11.5px] leading-[1.8] text-[#59606c]">
        Senior Frontend Engineer with 6 years building and shipping production
        React apps at scale. Led migration to React 19 server components across
        a 40-screen product. Mentored two junior engineers informally. Deep
        TypeScript, testing with Vitest and Playwright, design systems…
      </div>
      <div className="flex justify-end">
        <span className="inline-flex items-center gap-2 rounded-full bg-brand-ink px-[22px] py-[11px] text-sm font-semibold text-brand-cream">
          ✦ Score with AI
        </span>
      </div>
    </div>
  );
}

function Panel3() {
  return (
    <div
      data-demo-panel
      className="absolute inset-0 flex flex-col gap-3.5 rounded-[20px] border border-black/10 bg-white p-7 opacity-0 shadow-[0_30px_70px_rgba(22,26,33,0.12)]"
    >
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <span className="font-display text-base font-semibold">
            Priya Malhotra
          </span>
          <span className="text-xs text-[#9ba1ac]">
            Scored in 4.2s · llama-3.3-70b
          </span>
        </div>
        <span className="font-display text-[34px] font-bold text-[#5a8a1e]">
          82<span className="text-base text-[#9ba1ac]">/100</span>
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-black/[0.07]">
        <div
          className="h-full w-[82%] rounded-full"
          style={{ background: "linear-gradient(90deg,#5A8A1E,#8FCB3A)" }}
        />
      </div>
      <div className="mt-1 flex flex-col gap-[9px]">
        {REPORT.map((r) => (
          <div
            key={r.label}
            className="flex flex-col gap-1.5 rounded-xl border border-black/[0.08] px-[15px] py-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-[13.5px] font-medium">{r.label}</span>
              <span
                className={`rounded-full border px-[9px] py-[3px] font-mono text-[10px] tracking-[0.05em] ${r.fg} ${r.ring}`}
              >
                {r.verdict}
              </span>
            </div>
            <span className="font-mono text-[10.5px] leading-relaxed text-[#7e8694]">
              {r.evidence}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      data-demo
      className="bg-brand-cream px-6 pt-10 pb-[110px] text-brand-ink"
    >
      <div className="mx-auto max-w-6xl">
        <div data-reveal className="mb-14 max-w-[640px]">
          <span className="font-mono text-xs tracking-[0.08em] text-[#6b7280]">
            HOW IT WORKS
          </span>
          <h2 className="mt-3.5 font-display text-[clamp(32px,3.4vw,48px)] leading-[1.1] font-bold tracking-[-0.02em]">
            Three steps to a defensible shortlist.
          </h2>
        </div>

        <div data-demo-track className="h-[240vh] max-lg:h-auto">
          <div className="sticky top-[90px] grid grid-cols-[0.9fr_1.1fr] items-center gap-14 max-lg:static max-lg:grid-cols-1 max-lg:gap-10">
            <div
              data-demo-steps
              className="relative flex flex-col gap-1.5 pl-[34px]"
            >
              <div className="absolute top-[30px] bottom-14 left-[5px] w-0.5 rounded-full bg-black/[0.12] max-lg:hidden" />
              <div
                data-demo-line
                className="absolute top-[30px] left-[5px] h-0 w-0.5 rounded-full bg-brand-ink max-lg:hidden"
              />
              <div
                data-demo-dot
                className="absolute top-6 left-0 size-3 rounded-full border-[3px] border-brand-ink bg-brand-lime shadow-[0_0_0_5px_rgba(198,242,78,0.25)] max-lg:hidden"
              />
              {STEPS.map((s, i) => (
                <div
                  key={s.n}
                  data-demo-step
                  className="py-[18px]"
                  style={{ opacity: i === 0 ? 1 : 0.35 }}
                >
                  <div className="flex items-baseline gap-3">
                    <span className="font-mono text-xs text-[#9ba1ac]">
                      {s.n}
                    </span>
                    <h3 className="font-display text-xl font-semibold">
                      {s.title}
                    </h3>
                  </div>
                  <p className="mt-2.5 max-w-[400px] text-[14.5px] leading-relaxed text-[#59606c]">
                    {s.body}
                  </p>
                </div>
              ))}
            </div>

            <div className="relative h-120 max-lg:h-135">
              <Panel1 />
              <Panel2 />
              <Panel3 />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
