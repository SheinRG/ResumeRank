"use client";

import { ArrowRight, KeyRound, Loader2 } from "lucide-react";
import { useState } from "react";

import { AuthAlert } from "@/components/auth/auth-alert";
import { FormField } from "@/components/shared/form-field";
import { useActionForm } from "@/components/shared/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ssoLoginSchema, type SsoLoginInput } from "@resumerank/core/validators/sso";
import { signInWithSsoAction } from "@/server/actions/sso";

type SsoSignInFormProps = {
  next: string;
};

/**
 * Collapsed to one button until asked for: most people log in with a
 * password, and SSO only needs a work email to find the company's provider.
 */
function SsoSignInForm({ next }: SsoSignInFormProps) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [redirecting, setRedirecting] = useState(false);
  const { fieldErrors, formError, isPending, submit } = useActionForm({
    schema: ssoLoginSchema,
    action: (input: SsoLoginInput) => signInWithSsoAction(input, next),
    onSuccess: ({ url }) => {
      setRedirecting(true);
      window.location.assign(url);
    },
  });
  const busy = isPending || redirecting;

  if (!open) {
    return (
      <Button type="button" variant="outline" className="w-full" onClick={() => setOpen(true)}>
        <KeyRound aria-hidden="true" />
        Continue with SSO
      </Button>
    );
  }

  function handleSubmit(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    submit({ email });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
      {formError ? <AuthAlert>{formError}</AuthAlert> : null}
      <FormField label="Work email" htmlFor="sso-email" errors={fieldErrors.email}>
        <Input
          id="sso-email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoFocus
          required
        />
      </FormField>
      <Button type="submit" variant="outline" disabled={busy} className="w-full">
        {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
        {redirecting ? "Redirecting to your identity provider…" : "Continue with SSO"}
      </Button>
    </form>
  );
}

export { SsoSignInForm };
