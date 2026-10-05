import type { ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";

const NAV_KEYS = ["nav-1", "nav-2", "nav-3", "nav-4", "nav-5"];

/**
 * The prerendered frame of the signed-in app, shown while the session is
 * checked: same sidebar width, top bar height and content column as AppShell,
 * so the real shell swaps in without layout shift.
 */
export function AppShellSkeleton({ children }: { children?: ReactNode }) {
  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 md:flex">
        <div className="flex h-full w-full flex-col gap-6 bg-brand-night px-4 py-6">
          <Skeleton className="h-8 w-36 bg-brand-cream/10" />
          <div className="flex flex-col gap-2">
            {NAV_KEYS.map((key) => (
              <Skeleton key={key} className="h-10 w-full rounded-full bg-brand-cream/10" />
            ))}
          </div>
        </div>
      </aside>
      <div className="flex min-h-screen flex-col md:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center border-b border-border bg-background px-4 sm:px-6">
          <Skeleton className="ml-auto h-10 w-10 rounded-full sm:w-56" />
        </header>
        <main className="flex-1">
          <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</div>
        </main>
      </div>
    </>
  );
}
