import type { Metadata } from "next";

import { VerifyEmailPanel } from "@/components/auth/verify-email-panel";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FadeIn } from "@/components/motion";

export const metadata: Metadata = {
  title: "Verify email — ResumeRank",
};

type VerifyEmailPageProps = {
  searchParams: Promise<{ email?: string; token?: string }>;
};

async function VerifyEmailPage({ searchParams }: VerifyEmailPageProps) {
  const { email, token } = await searchParams;

  return (
    <FadeIn>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Email verification</CardTitle>
          <CardDescription>
            Confirming your address unlocks write access to your workspace.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <VerifyEmailPanel email={email} token={token} />
        </CardContent>
      </Card>
    </FadeIn>
  );
}

export default VerifyEmailPage;
