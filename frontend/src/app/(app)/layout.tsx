import { Suspense, type ReactNode } from "react";
import { redirect } from "next/navigation";

import { GateError, requireUser, type CurrentUser } from "@/lib/auth/guards";
import { AppShell } from "@/components/layout/app-shell";
import { AppShellSkeleton } from "@/components/layout/app-shell-skeleton";
import { VerifyBanner } from "@/components/layout/verify-banner";

async function loadCurrentUser(): Promise<CurrentUser> {
  try {
    return await requireUser();
  } catch (error) {
    if (error instanceof GateError) {
      redirect("/session-ended");
    }
    throw error;
  }
}

async function SignedInShell({ children }: { children: ReactNode }) {
  const user = await loadCurrentUser();
  if (!user.companyId) {
    redirect("/onboarding");
  }

  return (
    <AppShell user={user}>
      {!user.emailVerified ? <VerifyBanner email={user.email} /> : null}
      <main className="flex-1">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</div>
      </main>
    </AppShell>
  );
}

// Everything under the shell depends on who is signed in, so the session
// check streams inside a boundary and only the frame is prerendered.
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <Suspense fallback={<AppShellSkeleton />}>
        <SignedInShell>{children}</SignedInShell>
      </Suspense>
    </div>
  );
}
