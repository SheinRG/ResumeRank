import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { MfaSetupFlow } from "@/components/mfa/mfa-setup-flow";
import { FadeIn } from "@/components/motion";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { safeNext } from "@/lib/safe-next";
import { loadMfaSession } from "../gate";

export const metadata: Metadata = {
  title: "Set up two-factor authentication",
};

async function MfaSetupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const target = safeNext(next);
  const session = await loadMfaSession();
  if (session.mfa === "challenge") redirect(`/mfa?next=${encodeURIComponent(target)}`);
  // No redirect once the gate passes: adding the factor re-renders this page
  // in the same response, and the flow still has recovery codes to show.
  const complete = session.mfa === "pass";

  return (
    <FadeIn>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Set up two-factor authentication</CardTitle>
          <CardDescription>
            {complete
              ? "Two-factor authentication is on for your account."
              : `${session.user.companyName ?? "Your company"} requires a second step when you sign in. Add an authenticator app or a passkey to continue.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MfaSetupFlow next={target} complete={complete} />
        </CardContent>
      </Card>
    </FadeIn>
  );
}

export default MfaSetupPage;
