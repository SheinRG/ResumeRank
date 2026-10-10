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
import { isGoogleAuthEnabled, isSsoEnabled } from "@resumerank/core/env";

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
  SsoRequired: "Your company requires single sign-on. Use “Continue with SSO” to log in.",
  SsoFailed:
    "Single sign-on didn't complete. Try again, or ask your admin to check the identity provider settings.",
  SsoDomainNotVerified:
    "Your company's identity provider can't sign in that email address. Ask your admin to verify its domain.",
  SsoWrongWorkspace:
    "That email already belongs to another ResumeRank workspace, so it can't sign in through this company's SSO.",
  SsoAccountMismatch:
    "Your identity provider sent a different email than the one on your ResumeRank account. Ask your admin to check your SSO profile.",
};

function loginErrorMessage(code: string | undefined): string | null {
  if (!code) return null;
  if (code in LOGIN_ERRORS) return LOGIN_ERRORS[code as LoginErrorCode];
  // Auth.js's code when the provider itself reports a failure, e.g. an SSO
  // assertion the identity provider's certificate doesn't verify.
  if (code === "OAuthCallbackError") {
    return "Your sign-in provider couldn't confirm who you are. Try again, or ask your admin to check its settings.";
  }
  return "We couldn't sign you in. Try again.";
}

type LoginPageProps = {
  searchParams: Promise<{ next?: string; error?: string }>;
};

async function LoginPage({ searchParams }: LoginPageProps) {
  const { next, error } = await searchParams;
  const googleEnabled = isGoogleAuthEnabled();
  const ssoEnabled = isSsoEnabled();
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
          <LoginForm next={safeNext(next)} googleEnabled={googleEnabled} ssoEnabled={ssoEnabled} />
        </CardContent>
      </Card>
    </FadeIn>
  );
}

export default LoginPage;
