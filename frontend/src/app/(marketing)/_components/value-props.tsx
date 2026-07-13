const PROPS = [
  {
    n: "01",
    title: "Explainable verdicts",
    body: "Every verdict comes with a verbatim quote from the resume, not a mystery number. You can defend every shortlist decision.",
    rotate: "-rotate-2",
  },
  {
    n: "02",
    title: "Weighted scoring",
    body: "Must-have requirements count twice as much as nice-to-haves, so the score reflects what actually matters for the role.",
    rotate: "rotate-[1.5deg]",
  },
  {
    n: "03",
    title: "Pipeline built in",
    body: "Move candidates through new, screening, shortlisted, interview, offer, and hired — one place, whole team.",
    rotate: "-rotate-1",
  },
];

export function ValueProps() {
  return (
    <section id="why" className="bg-brand-cream px-6 py-[110px] text-brand-ink">
      <div className="mx-auto max-w-6xl">
        <div data-reveal className="mb-16 max-w-[640px]">
          <span className="font-mono text-xs tracking-[0.08em] text-[#6b7280]">
            WHY RESUMERANK
          </span>
          <h2
            data-split
            className="mt-3.5 font-display text-[clamp(32px,3.4vw,48px)] leading-[1.1] font-bold tracking-[-0.02em]"
          >
            A score is only useful if you can see{" "}
            <span className="text-[#5a8a1e]">why</span> it was given.
          </h2>
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-x-7 gap-y-9 px-1.5 pt-2.5 pb-[26px]">
          {PROPS.map((p) => (
            <div
              key={p.n}
              data-reveal
              className={`flex flex-col gap-4 rounded-md border border-black/[0.06] bg-white p-8 shadow-[0_1px_1px_rgba(22,26,33,0.05),0_8px_10px_-4px_rgba(22,26,33,0.12),0_20px_34px_-8px_rgba(22,26,33,0.16)] transition-[transform,box-shadow] duration-300 ease-out ${p.rotate} hover:-translate-y-1.5 hover:rotate-0`}
            >
              <span className="font-mono text-[13px] text-[#9ba1ac]">{p.n}</span>
              <h3 className="font-display text-[21px] font-semibold tracking-[-0.01em]">
                {p.title}
              </h3>
              <p className="text-[15px] leading-relaxed text-[#59606c]">
                {p.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
