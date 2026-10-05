import Link from "next/link";
import { Suspense } from "react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const FIELD_KEYS = ["field-1", "field-2"];

function AuthCardSkeleton() {
  return (
    <Card aria-busy="true" aria-label="Loading">
      <CardHeader className="flex flex-col gap-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-64" />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {FIELD_KEYS.map((key) => (
          <div key={key} className="flex flex-col gap-1.5">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>
        ))}
        <Skeleton className="h-11 w-full rounded-full" />
      </CardContent>
    </Card>
  );
}

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
        <div className="w-full max-w-md">
          {/* These pages read the session or the URL's token, so they stream
              into the prerendered frame. */}
          <Suspense fallback={<AuthCardSkeleton />}>{children}</Suspense>
        </div>
      </main>
    </div>
  );
}

export default AuthLayout;
