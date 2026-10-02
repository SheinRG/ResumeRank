import type { Metadata } from "next";

import { AuthAlert } from "@/components/auth/auth-alert";
import { LoginForm } from "@/components/auth/login-form";
import type { LoginErrorCode } from "@/lib/auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FadeIn } from "@/components/motion";
import { isGoogleAuthEnabled } from "@resumerank/core/env";

export const metadata: Metadata = {
  title: "Log in",
};

function safeNext(next: string | undefined): string {
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return "/dashboard";
}

const LOGIN_ERRORS: Record<LoginErrorCode, string> = {
  GoogleEmailUnverified:
    "Google hasn't verified that email address, so we can't sign you in with it.",
  AccountNotLinked:
    "An account with this email already exists. Log in with your password and verify your email, then you can use Google.",
  SessionExpired: "Your session has ended. Log in again to continue.",
};

function loginErrorMessage(code: string | undefined): string | null {
  if (!code) return null;
  if (code in LOGIN_ERRORS) return LOGIN_ERRORS[code as LoginErrorCode];
  return "We couldn't sign you in. Try again.";
}

type LoginPageProps = {
  searchParams: Promise<{ next?: string; error?: string }>;
};

async function LoginPage({ searchParams }: LoginPageProps) {
  const { next, error } = await searchParams;
  const googleEnabled = isGoogleAuthEnabled();
  const errorMessage = loginErrorMessage(error);

  return (
    <FadeIn>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Welcome back</CardTitle>
          <CardDescription>
            Log in to keep screening candidates.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {errorMessage ? <AuthAlert>{errorMessage}</AuthAlert> : null}
          <LoginForm next={safeNext(next)} googleEnabled={googleEnabled} />
        </CardContent>
      </Card>
    </FadeIn>
  );
}

export default LoginPage;
