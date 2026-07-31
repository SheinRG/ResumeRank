import Link from "next/link";

function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-muted/40 dark:bg-background">
      <header className="px-6 py-6 sm:px-8">
        <Link
          href="/"
          className="text-sm font-semibold tracking-tight text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:rounded-sm"
        >
          ResumeRank
        </Link>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}

export default AuthLayout;
