import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PasswordChangeGate } from "@/components/auth/password-change-gate";
import { FadeIn } from "@/components/motion";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { GateError, getSignedInSession, type SignedInSession } from "@/lib/auth/guards";
import { accountPasswordPolicy } from "@resumerank/core/auth/password-policy";

export const metadata: Metadata = {
  title: "Choose a new password",
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
 * Where the guards hold a password sign-in whose password a workspace's
 * policy no longer accepts. Setting a new one releases this sign-in.
 */
async function PasswordChangePage() {
  const session = await loadSession();
  if (session.mfa === "challenge") redirect("/mfa");
  if (session.mfa === "setup") redirect("/mfa/setup");
  if (!session.passwordChange) redirect("/dashboard");

  const policy = await accountPasswordPolicy(session.user.id);

  return (
    <FadeIn>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Choose a new password</CardTitle>
          <CardDescription>
            Your password doesn&apos;t meet the password policy of a workspace you belong to. Choose a
            new one to continue. Your other devices will be signed out.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PasswordChangeGate policy={policy} />
        </CardContent>
      </Card>
    </FadeIn>
  );
}

export default PasswordChangePage;
