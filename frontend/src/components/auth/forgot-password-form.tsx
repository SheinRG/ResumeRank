"use client";

import Link from "next/link";
import { ArrowLeft, Loader2, Send } from "lucide-react";
import { useState, useTransition } from "react";

import { AuthAlert } from "@/components/auth/auth-alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/shared/form-field";
import { Input } from "@/components/ui/input";
import { forgotPasswordSchema } from "@resumerank/core/validators/auth";
import { forgotPasswordAction } from "@/server/actions/auth";

function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setFormError(null);
    setFieldError(null);

    const parsed = forgotPasswordSchema.safeParse({ email });
    if (!parsed.success) {
      setFieldError(parsed.error.flatten().fieldErrors.email?.[0] ?? null);
      return;
    }

    startTransition(async () => {
      const result = await forgotPasswordAction(parsed.data);
      if (!result.ok) {
        setFieldError(result.fieldErrors?.email?.[0] ?? null);
        setFormError(result.fieldErrors?.email ? null : result.error);
        return;
      }
      setSent(true);
    });
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-4">
        <AuthAlert tone="success">
          If an account exists for that email, we sent a link to reset the
          password. It expires in 30 minutes.
        </AuthAlert>
        <Link
          href="/login"
          className="flex items-center gap-1.5 text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:rounded-sm"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to login
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      {formError ? <AuthAlert>{formError}</AuthAlert> : null}
      <FormField
        label="Email"
        htmlFor="forgot-email"
        errors={fieldError ? [fieldError] : undefined}
      >
        <Input
          id="forgot-email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </FormField>
      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <Send aria-hidden="true" />
        )}
        Send reset link
      </Button>
      <Link
        href="/login"
        className="flex items-center justify-center gap-1.5 text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:rounded-sm"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to login
      </Link>
    </form>
  );
}

export { ForgotPasswordForm };
