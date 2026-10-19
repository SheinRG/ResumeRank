import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { StaffNav } from "@/components/staff/staff-nav";
import { StepUpProvider } from "@/components/step-up/step-up-provider";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  GateError,
  gateRedirectPath,
  NotStaffError,
  requireStaff,
  StaffSecondFactorError,
} from "@/lib/auth/guards";
import type { StaffActor } from "@resumerank/core/staff/actor";

export const metadata: Metadata = {
  title: { template: "%s · Staff · ResumeRank", default: "Staff · ResumeRank" },
  robots: { index: false, follow: false },
};

function Frame({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <>
      <header className="border-b border-white/10 bg-brand-night text-brand-cream">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
          <Link href="/staff" className="flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="flex size-7 items-center justify-center rounded-[9px] bg-brand-lime font-display-app text-[15px] font-semibold text-brand-night">
              R
            </span>
            <span className="font-display-app text-[17px] font-medium">ResumeRank</span>
            <span className="font-mono text-xs uppercase tracking-wider text-brand-lime">Staff</span>
          </Link>
          {right}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </>
  );
}

type StaffLoad = { actor: StaffActor } | { blocked: "second-factor" };

async function loadStaff(): Promise<StaffLoad> {
  try {
    return { actor: await requireStaff() };
  } catch (error) {
    if (error instanceof NotStaffError) notFound();
    if (error instanceof StaffSecondFactorError) return { blocked: "second-factor" };
    if (error instanceof GateError) redirect(gateRedirectPath(error));
    throw error;
  }
}

async function StaffShell({ children }: { children: ReactNode }) {
  const loaded = await loadStaff();
  if ("blocked" in loaded) {
    return (
      <Frame>
        <Card className="mx-auto max-w-lg">
          <CardHeader>
            <CardTitle>Your own second factor first</CardTitle>
            <CardDescription>
              The staff console opens only on a sign-in that proved your own second factor, an
              authenticator app or a passkey. Single sign-on doesn&apos;t count: a customer&apos;s
              identity provider vouches for its own members, not for ResumeRank staff. Set one up in
              Settings → Security, then sign in again with your password.
            </CardDescription>
          </CardHeader>
        </Card>
      </Frame>
    );
  }

  const { actor } = loaded;
  return (
    <StepUpProvider>
      <Frame
        right={
          <>
            <StaffNav />
            <div className="ml-auto flex items-center gap-3 text-sm">
              <span className="hidden text-brand-cream/80 sm:inline">{actor.email}</span>
              <Badge variant="outline" className="border-brand-lime/40 font-mono text-brand-lime">
                {actor.role === "ADMIN" ? "admin" : "support"}
              </Badge>
              <Link
                href="/dashboard"
                className="rounded-sm text-brand-cream/80 underline-offset-4 outline-none hover:text-brand-cream hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                Back to the app
              </Link>
            </div>
          </>
        }
      >
        {children}
      </Frame>
    </StepUpProvider>
  );
}

function StaffShellSkeleton() {
  return (
    <Frame right={<Skeleton className="ml-auto h-5 w-48 bg-white/10" />}>
      <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    </Frame>
  );
}

// Who is signed in decides everything here, so the staff check streams
// inside a boundary and only the frame is prerendered.
export default function StaffLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <Suspense fallback={<StaffShellSkeleton />}>
        <StaffShell>{children}</StaffShell>
      </Suspense>
    </div>
  );
}
