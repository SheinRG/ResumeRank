import type { Metadata } from "next";

import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FadeIn } from "@/components/motion";
import { accountPasswordPolicy, DEFAULT_PASSWORD_POLICY } from "@resumerank/core/auth/password-policy";
import { findPasswordResetUser } from "@resumerank/core/auth/tokens";

export const metadata: Metadata = {
  title: "Reset password",
};

type ResetPasswordPageProps = {
  searchParams: Promise<{ token?: string }>;
};

async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const { token } = await searchParams;
  const owner = token ? await findPasswordResetUser(token) : null;
  const policy = owner ? await accountPasswordPolicy(owner) : DEFAULT_PASSWORD_POLICY;

  return (
    <FadeIn>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Choose a new password</CardTitle>
          <CardDescription>
            Pick something you haven&apos;t used before.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResetPasswordForm token={token} policy={policy} />
        </CardContent>
      </Card>
    </FadeIn>
  );
}

export default ResetPasswordPage;
