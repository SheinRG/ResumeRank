import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { GateError, requireUser, type CurrentUser } from "@/lib/auth/guards";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { VerifyBanner } from "@/components/layout/verify-banner";

async function loadCurrentUser(): Promise<CurrentUser> {
  try {
    return await requireUser();
  } catch (error) {
    if (error instanceof GateError) {
      redirect("/login");
    }
    throw error;
  }
}

export default async function AppLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const user = await loadCurrentUser();

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar user={user} />
      <div className="flex min-h-screen flex-col md:pl-60">
        <TopBar user={user} />
        {!user.emailVerified ? <VerifyBanner email={user.email} /> : null}
        <main className="flex-1">
          <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
