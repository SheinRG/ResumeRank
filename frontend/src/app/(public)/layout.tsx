import Link from "next/link";
import { Suspense } from "react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const LINE_KEYS = ["line-1", "line-2", "line-3", "line-4"];

function PublicCardSkeleton() {
  return (
    <Card aria-busy="true" aria-label="Loading">
      <CardHeader className="flex flex-col gap-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-72" />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {LINE_KEYS.map((key) => (
          <Skeleton key={key} className="h-4 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}

/** Pages candidates reach from a recruiter's link: no app chrome, no sign-in. */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
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
      <main className="flex flex-1 justify-center px-4 pb-16">
        <div className="w-full max-w-2xl">
          {/* Each page reads its slug or token from the URL, so it streams into the frame. */}
          <Suspense fallback={<PublicCardSkeleton />}>{children}</Suspense>
        </div>
      </main>
    </div>
  );
}
