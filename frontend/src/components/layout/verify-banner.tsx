"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { resendVerificationAction } from "@/server/actions/auth";

export function VerifyBanner({ email }: { email: string }) {
  const [dismissed, setDismissed] = useState(false);
  const [pending, startTransition] = useTransition();

  if (dismissed) return null;

  function handleResend() {
    startTransition(async () => {
      const result = await resendVerificationAction({ email });
      if (result.ok) {
        toast.success("Verification email sent. Check your inbox.");
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div
      role="status"
      className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 sm:px-6 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200"
    >
      <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
      <p className="flex-1">Verify your email to unlock editing.</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleResend}
        disabled={pending}
        className="border-amber-300 bg-transparent text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:text-amber-200 dark:hover:bg-amber-900/40"
      >
        {pending ? "Sending…" : "Resend email"}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
        className="size-8 text-amber-900 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-900/40"
      >
        <X className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
