"use client";

import { Loader2, Mail } from "lucide-react";
import { useState, useTransition } from "react";

import { AuthAlert } from "@/components/auth/auth-alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/shared/form-field";
import { Input } from "@/components/ui/input";
import { resendVerificationAction } from "@/server/actions/auth";

type ResendVerificationFormProps = {
  initialEmail?: string;
};

function ResendVerificationForm({ initialEmail = "" }: ResendVerificationFormProps) {
  const [email, setEmail] = useState(initialEmail);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setError(null);
    setFieldError(null);
    startTransition(async () => {
      const result = await resendVerificationAction({ email });
      if (!result.ok) {
        setFieldError(result.fieldErrors?.email?.[0] ?? null);
        setError(result.fieldErrors?.email ? null : result.error);
        return;
      }
      setSent(true);
    });
  }

  if (sent) {
    return (
      <AuthAlert tone="success">
        If an account for <span className="font-medium">{email}</span> needs
        verifying, a new link is on its way.
      </AuthAlert>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
      {error ? <AuthAlert>{error}</AuthAlert> : null}
      <FormField
        label="Email"
        htmlFor="resend-email"
        errors={fieldError ? [fieldError] : undefined}
      >
        <Input
          id="resend-email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </FormField>
      <Button type="submit" variant="outline" disabled={isPending}>
        {isPending ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <Mail aria-hidden="true" />
        )}
        Resend verification email
      </Button>
    </form>
  );
}

export { ResendVerificationForm };
