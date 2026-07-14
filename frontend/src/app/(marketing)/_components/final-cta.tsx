import Link from "next/link";

export function FinalCta() {
  return (
    <section className="relative overflow-clip bg-brand-night px-6 pt-[130px] text-brand-cream">
      <div
        data-parallax="-0.15"
        aria-hidden
        className="pointer-events-none absolute -top-35 left-1/2 h-125 w-200 -translate-x-1/2 rounded-full"
        style={{
          background:
            "radial-gradient(ellipse,rgba(198,242,78,0.13) 0%,rgba(198,242,78,0) 65%)",
        }}
      />
      <div className="relative mx-auto flex max-w-[840px] flex-col items-center gap-7 text-center">
        <h2
          data-split
          className="font-display text-[clamp(40px,4.5vw,64px)] leading-[1.05] font-bold tracking-[-0.03em]"
        >
          Stop guessing.
          <br />
          Start <span className="text-brand-lime">quoting.</span>
        </h2>
        <p
          data-reveal
          className="max-w-[480px] text-[17px] leading-relaxed text-brand-muted"
        >
          Create a job, paste a resume, and see an evidence-backed score in
          under a minute. Free to start.
        </p>
        <Link
          href="/register"
          data-reveal
          aria-label="Get started free"
          className="group inline-flex rounded-full"
        >
          <span className="relative flex items-center justify-center overflow-hidden rounded-full bg-brand-lime px-[34px] py-[17px] text-[17px] font-semibold text-brand-night transition-transform duration-[450ms] ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover:scale-[0.94] motion-reduce:transition-none motion-reduce:group-hover:scale-100">
            <span
              aria-hidden
              className="flex items-center gap-2.5 whitespace-nowrap transition-transform duration-[650ms] ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover:translate-x-[150%] motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
            >
              Get started free
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
    </section>
  );
}
