const QUOTES = [
  {
    body: "The evidence quotes changed our debriefs. Instead of 'I liked her vibe,' it's 'here's the line that proves the requirement.'",
    initials: "MK",
    name: "Mara Kessler",
    role: "Head of Talent, Fieldstone Labs",
    rotate: "-rotate-2",
  },
  {
    body: "We screened 140 applicants for one role in an afternoon. The weighted rubric caught two people our keyword filter had thrown away.",
    initials: "DO",
    name: "Deji Okafor",
    role: "Recruiting Lead, Parallel HQ",
    rotate: "rotate-[1.5deg]",
  },
  {
    body: "Server-enforced roles and the audit log got it past our security review in a week. That never happens with hiring tools.",
    initials: "SL",
    name: "Sofia Lindqvist",
    role: "VP People, Novacore",
    rotate: "-rotate-1",
  },
];

export function Testimonials() {
  return (
    <section className="bg-brand-night px-6 py-[110px] text-brand-cream">
      <div className="mx-auto max-w-6xl">
        <div data-reveal className="mb-14 max-w-[640px]">
          <span className="font-mono text-xs tracking-[0.08em] text-brand-faint">
            WHAT TEAMS SAY
          </span>
          <h2 className="mt-3.5 font-display text-[clamp(32px,3.4vw,48px)] leading-[1.1] font-bold tracking-[-0.02em]">
            Recruiters stopped arguing about gut feel.
          </h2>
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-x-[30px] gap-y-10 px-2 pt-2.5 pb-[30px]">
          {QUOTES.map((q) => (
            <figure
              key={q.name}
              data-reveal
              className={`flex flex-col gap-5 rounded-md border border-white/[0.07] bg-brand-panel p-[30px] shadow-[0_1px_1px_rgba(0,0,0,0.3),0_10px_14px_-6px_rgba(0,0,0,0.45),0_26px_40px_-10px_rgba(0,0,0,0.5)] transition-[transform,box-shadow] duration-300 ease-out ${q.rotate} hover:-translate-y-1.5 hover:rotate-0`}
            >
              <span
                aria-hidden
                className="font-display text-[40px] leading-[0.6] text-brand-lime"
              >
                “
              </span>
              <blockquote className="text-[15.5px] leading-relaxed text-[#c7ccd6]">
                {q.body}
              </blockquote>
              <figcaption className="mt-auto flex items-center gap-3">
                <span className="flex size-[38px] items-center justify-center rounded-full bg-brand-lime/15 text-[13px] font-semibold text-brand-lime">
                  {q.initials}
                </span>
                <span className="flex flex-col">
                  <span className="text-sm font-semibold">{q.name}</span>
                  <span className="text-xs text-[#8a91a0]">{q.role}</span>
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
