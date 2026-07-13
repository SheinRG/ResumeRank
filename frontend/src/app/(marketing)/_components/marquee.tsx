const COMPANIES = [
  "Fieldstone Labs",
  "Nordwind",
  "Parallel HQ",
  "Brightline",
  "Hatch & Co",
  "Novacore",
  "Lumenly",
];

const LABEL = "TRUSTED BY LEAN RECRUITING TEAMS AT";

export function Marquee() {
  // Duplicated inline so the -50% translate loops seamlessly.
  const run = [LABEL, ...COMPANIES];

  return (
    <div className="relative overflow-hidden border-y border-white/[0.07] py-[26px]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-[2]"
        style={{
          background:
            "linear-gradient(90deg,#0A0D14 0%,transparent 12%,transparent 88%,#0A0D14 100%)",
        }}
      />
      <div
        data-marquee-track
        aria-hidden
        className="flex w-max items-center gap-18"
      >
        {[0, 1].map((copy) =>
          run.map((item, i) => (
            <span
              key={`${copy}-${item}-${i}`}
              className={
                i === 0
                  ? "font-mono text-xs tracking-[0.08em] whitespace-nowrap text-[#5B6270]"
                  : "font-display text-[19px] font-semibold whitespace-nowrap text-[#7E8694]"
              }
            >
              {item}
            </span>
          )),
        )}
      </div>
      <span className="sr-only">{LABEL} lean recruiting teams.</span>
    </div>
  );
}
