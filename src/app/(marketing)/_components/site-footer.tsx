import Link from "next/link";

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold tracking-tight text-foreground">
            ResumeRank
          </span>
          <p className="text-sm text-muted-foreground">
            Evidence-based AI resume screening for recruiters.
          </p>
        </div>

        <nav aria-label="Footer" className="flex items-center gap-6">
          <Link
            href="/login"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Sign in
          </Link>
          <Link
            href="/register"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Get started
          </Link>
        </nav>

        <p className="text-sm text-muted-foreground">
          © {year} ResumeRank
        </p>
      </div>
    </footer>
  );
}
