import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { NetworkBlockedActions } from "@/components/auth/network-blocked-actions";
import { FadeIn } from "@/components/motion";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { GateError, getSignedInSession, type SignedInSession } from "@/lib/auth/guards";
import { UNKNOWN_IP } from "@resumerank/core/request-ip";

export const metadata: Metadata = {
  title: "Not available on this network",
};

async function loadSession(): Promise<SignedInSession> {
  try {
    return await getSignedInSession();
  } catch (error) {
    if (error instanceof GateError) redirect("/session-ended");
    throw error;
  }
}

/**
 * Where the guards send a session whose workspace doesn't allow this
 * network. The session stays alive: back on an approved network, "Try
 * again" is all it takes.
 */
async function NetworkBlockedPage() {
  const session = await loadSession();
  if (session.mfa === "challenge") redirect("/mfa");
  if (session.mfa === "setup") redirect("/mfa/setup");
  if (session.network === "allowed") redirect("/dashboard");

  const { user, clientIp } = session;
  const company = user.companyName ?? "Your company";
  const others = user.workspaces
    .filter((workspace) => workspace.companyId !== user.companyId && workspace.blockedBy === null)
    .map(({ companyId, name }) => ({ companyId, name }));

  return (
    <FadeIn>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Not available on this network</CardTitle>
          <CardDescription>
            {company} only allows access from its approved networks, such as the office or its VPN.
            Connect to one, then try again. If you think this network should be allowed, ask a
            workspace owner.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <p className="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground">
            {clientIp === UNKNOWN_IP ? (
              "We couldn't determine your IP address, so it can't be matched against the allowed networks."
            ) : (
              <>
                You&apos;re connecting from <span className="font-mono text-foreground">{clientIp}</span>.
              </>
            )}
          </p>
          <NetworkBlockedActions workspaces={others} />
        </CardContent>
      </Card>
    </FadeIn>
  );
}

export default NetworkBlockedPage;
