import type { Metadata } from "next";

import { LoginForm } from "@/components/auth/login-form";
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

type LoginPageProps = {
  searchParams: Promise<{ next?: string }>;
};

async function LoginPage({ searchParams }: LoginPageProps) {
  const { next } = await searchParams;
  const googleEnabled = isGoogleAuthEnabled();

  return (
    <FadeIn>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Welcome back</CardTitle>
          <CardDescription>
            Log in to keep screening candidates.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm next={safeNext(next)} googleEnabled={googleEnabled} />
        </CardContent>
      </Card>
    </FadeIn>
  );
}

export default LoginPage;
