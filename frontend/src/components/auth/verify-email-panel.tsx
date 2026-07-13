"use client";

import Link from "next/link";
import { CircleCheckBig, CircleX, Loader2, MailCheck } from "lucide-react";
import { useState, useTransition } from "react";

import { ResendVerificationForm } from "@/components/auth/resend-verification-form";
import { Button } from "@/components/ui/button";
import { verifyEmailAction } from "@/server/actions/auth";

type VerifyEmailPanelProps = {
  email?: string;
  token?: string;
};

function VerifyEmailPanel({ email, token }: VerifyEmailPanelProps) {
  const [state, setState] = useState<"idle" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!email || !token) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <MailCheck className="size-10 text-primary" aria-hidden="true" />
          <div className="flex flex-col gap-1">
            <p className="text-base font-medium">Verify your email</p>
            <p className="text-sm text-muted-foreground">
              Open the link from your verification email, or request a new
              one below.
            </p>
          </div>
        </div>
        <ResendVerificationForm initialEmail={email} />
      </div>
    );
  }

  if (state === "success") {
    return (
      <div className="flex flex-col items-center gap-4 py-2 text-center">
        <CircleCheckBig className="size-10 text-emerald-600" aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <p className="text-base font-medium">Email verified</p>
          <p className="text-sm text-muted-foreground">
            You now have write access to your workspace.
          </p>
        </div>
        <Button asChild className="w-full">
          <Link href="/login">Go to login</Link>
        </Button>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <CircleX className="size-10 text-destructive" aria-hidden="true" />
          <div className="flex flex-col gap-1">
            <p className="text-base font-medium">Verification failed</p>
            {error ? (
              <p className="text-sm text-muted-foreground">{error}</p>
            ) : null}
          </div>
        </div>
        <ResendVerificationForm initialEmail={email} />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 py-2 text-center">
      <MailCheck className="size-10 text-primary" aria-hidden="true" />
      <div className="flex flex-col gap-1">
        <p className="text-base font-medium">Confirm your email</p>
        <p className="text-sm text-muted-foreground">
          Click below to verify <span className="font-medium">{email}</span>.
        </p>
      </div>
      <Button
        className="w-full"
        disabled={isPending}
        onClick={() => {
          startTransition(async () => {
            const result = await verifyEmailAction(email, token);
            if (!result.ok) {
              setError(result.error);
              setState("error");
              return;
            }
            setState("success");
          });
        }}
      >
        {isPending ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : null}
        Verify my email
      </Button>
    </div>
  );
}

export { VerifyEmailPanel };
