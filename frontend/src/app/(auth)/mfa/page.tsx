import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { MfaChallenge } from "@/components/mfa/mfa-challenge";
import { FadeIn } from "@/components/motion";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { safeNext } from "@/lib/safe-next";
import { getMfaMethods } from "@resumerank/core/auth/mfa/factors";
import { loadMfaSession } from "./gate";

export const metadata: Metadata = {
  title: "Two-factor authentication",
};

async function MfaChallengePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const target = safeNext(next);
  const session = await loadMfaSession();
  if (session.mfa === "setup") redirect(`/mfa/setup?next=${encodeURIComponent(target)}`);
  if (session.mfa === "pass") redirect(target);

  const methods = await getMfaMethods(session.user.id);

  return (
    <FadeIn>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Confirm it&apos;s you</CardTitle>
          <CardDescription>
            Your account ({session.user.email}) uses two-factor authentication. Finish signing in with
            one of your methods.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MfaChallenge methods={methods} next={target} />
        </CardContent>
      </Card>
    </FadeIn>
  );
}

export default MfaChallengePage;
