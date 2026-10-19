import type { Metadata } from "next";
import { LogOut } from "lucide-react";
import { redirect } from "next/navigation";

import { FadeIn } from "@/components/motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { GateError, gateRedirectPath, getSignedInSession, WorkspaceSuspendedError } from "@/lib/auth/guards";
import { logoutAction } from "@/server/actions/auth";

export const metadata: Metadata = {
  title: "Workspace suspended",
};

/** Lands here only while it's true: otherwise on to wherever the guards would send the session. */
async function assertSuspended(): Promise<void> {
  try {
    await getSignedInSession();
  } catch (error) {
    if (error instanceof WorkspaceSuspendedError) return;
    if (error instanceof GateError) redirect(gateRedirectPath(error));
    throw error;
  }
  redirect("/dashboard");
}

/**
 * Where the guards send someone whose every workspace ResumeRank has
 * suspended. Nothing in it has been deleted; signing in works again as soon
 * as the suspension is lifted.
 */
async function WorkspaceSuspendedPage() {
  await assertSuspended();

  return (
    <FadeIn>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Workspace suspended</CardTitle>
          <CardDescription>
            ResumeRank has suspended your workspace, so no one can open it for now. Nothing in it has
            been deleted. A workspace owner can contact ResumeRank support to find out why and what&apos;s
            needed to lift it; you&apos;ll be able to sign in again as soon as it is.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={logoutAction}>
            <Button type="submit" variant="outline" className="w-full">
              <LogOut aria-hidden="true" />
              Sign out
            </Button>
          </form>
        </CardContent>
      </Card>
    </FadeIn>
  );
}

export default WorkspaceSuspendedPage;
