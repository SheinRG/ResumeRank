import Link from "next/link";

import { RotatingText } from "@/components/ui/rotating-text";

const STATS = ["60s to shortlist", "2× weight on must-haves", "0 black boxes"];

// Payoff words that all complete "Every score comes with ___" and reinforce
// the explainable-scoring promise. Kept descender-free so the reveal's
// overflow-clip never trims a letter.
const ROTATING_WORDS = [
  "evidence.",
  "the exact line.",
  "a citation.",
  "the reason.",
  "the source.",
];

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

      <div
        data-parallax="-0.06"
        className="relative mx-auto flex w-full max-w-[840px] flex-col items-center gap-[30px] text-center"
      >
        <h1
          data-reveal
          className="font-display text-[clamp(44px,6vw,80px)] leading-[1.2] font-bold tracking-[-0.03em] text-brand-cream"
        >
          Every score comes with{" "}
          <span className="inline-block align-bottom">
            <RotatingText
              texts={ROTATING_WORDS}
              mainClassName="justify-center overflow-hidden rounded-2xl bg-brand-lime px-4 py-0.5 text-brand-night"
              splitLevelClassName="overflow-hidden pb-1"
              animatePresenceMode="popLayout"
              staggerFrom="last"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "-120%" }}
              staggerDuration={0.025}
              transition={{ type: "spring", damping: 30, stiffness: 400 }}
              rotationInterval={2200}
            />
          </span>
        </h1>
        <p
          data-reveal
          className="max-w-[560px] text-lg leading-relaxed text-brand-muted"
        >
          Paste a resume, get a weighted 0 to 100 score, and see the exact line
          that earned every verdict, strong, partial, or missing. Shortlist in
          60 seconds without trusting a black box.
        </p>
        <div data-reveal>
          <Link
            href="/register"
            aria-label="Start scoring free"
            className="group inline-flex rounded-full"
          >
            <span className="relative flex items-center justify-center overflow-hidden rounded-full bg-brand-lime px-[30px] py-4 text-base font-semibold text-brand-night transition-transform duration-[450ms] ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover:scale-[0.94] motion-reduce:transition-none motion-reduce:group-hover:scale-100">
              <span
                aria-hidden
                className="flex items-center gap-2.5 whitespace-nowrap transition-transform duration-[650ms] ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover:translate-x-[150%] motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
              >
                Start scoring free
                <span className="font-display">→</span>
              </span>
              <span
                aria-hidden
                className="absolute inset-0 flex -translate-x-[150%] items-center justify-center gap-2.5 whitespace-nowrap transition-transform duration-[650ms] ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover:translate-x-0 motion-reduce:hidden"
              >
                Go for it
                <span className="font-display">→</span>
              </span>
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
