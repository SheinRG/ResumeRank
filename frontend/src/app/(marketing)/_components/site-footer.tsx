import Link from "next/link";

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="bg-brand-night px-6 pt-[110px] text-brand-cream">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-5 border-t border-white/[0.08] py-9 pb-11">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="flex size-[22px] items-center justify-center rounded-md bg-brand-lime font-display text-xs font-bold text-brand-night">
            R
          </span>
          <span className="font-display text-[15px] font-semibold">
            ResumeRank
          </span>
          <span className="ml-2 text-[12.5px] text-[#5b6270]">
            © {year} · Explainable AI screening
          </span>
        </div>
        <nav
          aria-label="Footer"
          className="flex gap-[26px] text-[13.5px] text-[#8a91a0]"
        >
          <a href="#why" className="transition-colors hover:text-brand-cream">
            Why
          </a>
          <a href="#faq" className="transition-colors hover:text-brand-cream">
            FAQ
          </a>
          <Link
            href="/login"
            className="transition-colors hover:text-brand-cream"
          >
            Sign in
          </Link>
          <Link
            href="/register"
            className="transition-colors hover:text-brand-cream"
          >
            Get started
          </Link>
        </nav>
      </div>
    </footer>
  );
}
