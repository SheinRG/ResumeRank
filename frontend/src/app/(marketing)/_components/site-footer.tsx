import Link from "next/link";

// lucide-react dropped its brand logos, so the GitHub mark is inlined here.
function GithubMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-[18px]"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58v-2.03c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.11-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6.01 0c2.29-1.55 3.3-1.23 3.3-1.23.65 1.66.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.62-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.83.58A12 12 0 0 0 24 12.5C24 5.87 18.63.5 12 .5Z" />
    </svg>
  );
}

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
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-2 border-t border-white/[0.08] py-8 text-center">
        <p className="text-[13px] text-[#8a91a0]">
          Developed by{" "}
          <span className="font-medium text-brand-cream">Raghav Gangwar</span>
        </p>
        <a
          href="https://github.com/SheinRG"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Raghav Gangwar on GitHub"
          className="flex size-9 items-center justify-center rounded-full text-[#8a91a0] transition-colors hover:bg-white/5 hover:text-brand-cream"
        >
          <GithubMark />
        </a>
      </div>
    </footer>
  );
}
