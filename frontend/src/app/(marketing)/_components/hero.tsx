import Link from "next/link";

const STATS = ["60s to shortlist", "2× weight on must-haves", "0 black boxes"];

export function Hero() {
  return (
    <header
      id="top"
      className="relative flex min-h-screen items-center overflow-clip px-6 pt-35 pb-25"
    >
      <div
        data-parallax="-0.25"
        aria-hidden
        className="pointer-events-none absolute -top-45 -right-35 size-180 rounded-full"
        style={{
          background:
            "radial-gradient(circle,rgba(198,242,78,0.16) 0%,rgba(198,242,78,0) 62%)",
        }}
      />
      <div
        data-parallax="0.18"
        aria-hidden
        className="pointer-events-none absolute -bottom-65 -left-50 size-160 rounded-full"
        style={{
          background:
            "radial-gradient(circle,rgba(94,124,255,0.12) 0%,rgba(94,124,255,0) 60%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.035) 1px,transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage:
            "radial-gradient(ellipse 80% 70% at 50% 30%,black 30%,transparent 100%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 80% 70% at 50% 30%,black 30%,transparent 100%)",
        }}
      />

      <div className="relative mx-auto flex w-full max-w-[840px] flex-col items-center gap-[30px] text-center">
        <h1
          data-split
          className="font-display text-[clamp(44px,6vw,80px)] leading-[1.04] font-bold tracking-[-0.03em] text-brand-cream"
        >
          Every score comes with{" "}
          <span className="text-brand-lime">evidence.</span>
        </h1>
        <p
          data-reveal
          className="max-w-[560px] text-lg leading-relaxed text-brand-muted"
        >
          Paste a resume, get a weighted 0–100 score, and see the exact line
          that earned every verdict — strong, partial, or missing. Shortlist in
          60 seconds without trusting a black box.
        </p>
        <div data-reveal>
          <Link
            href="/register"
            data-magnetic
            className="inline-flex items-center justify-center gap-2.5 rounded-full bg-brand-lime px-[30px] py-4 text-base font-semibold text-brand-night transition-transform hover:scale-[0.96]"
          >
            Start scoring free
            <span className="font-display" aria-hidden>
              →
            </span>
          </Link>
        </div>
        <div
          data-reveal
          className="mt-2 flex flex-wrap items-center justify-center gap-x-7 gap-y-2 font-mono text-[12.5px] text-brand-faint"
        >
          {STATS.map((stat, i) => (
            <div key={stat} className="flex items-center gap-x-7">
              {i > 0 && (
                <span aria-hidden className="text-white/20">
                  /
                </span>
              )}
              <span>{stat}</span>
            </div>
          ))}
        </div>
      </div>
    </header>
  );
}
