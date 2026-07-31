"use client";

import Link from "next/link";
import { Loader2, MailCheck, UserPlus } from "lucide-react";
import { useState } from "react";

import { AuthAlert } from "@/components/auth/auth-alert";
import { PasswordInput } from "@/components/auth/password-input";
import { ResendVerificationForm } from "@/components/auth/resend-verification-form";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/shared/form-field";
import { Input } from "@/components/ui/input";
import { useActionForm } from "@/components/shared/use-action-form";
import { registerCompanySchema } from "@resumerank/core/validators/company";
import { registerAction } from "@/server/actions/auth";

function RegisterForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);
  const { fieldErrors, formError, isPending, submit } = useActionForm({
    schema: registerCompanySchema,
    action: registerAction,
    onSuccess: (data) => setRegisteredEmail(data.email),
  });

  function handleSubmit(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    submit({ name, email, password, companyName });
  }

  if (registeredEmail) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <MailCheck className="size-10 text-primary" aria-hidden="true" />
          <div className="flex flex-col gap-1">
            <p className="text-base font-medium">Check your inbox</p>
            <p className="text-sm text-muted-foreground">
              We sent a verification link to{" "}
              <span className="font-medium text-foreground">
                {registeredEmail}
              </span>
              . Verify your email to unlock write access.
            </p>
            <p className="text-xs text-muted-foreground">
              (in local dev the link appears in the server console)
            </p>
          </div>
        </div>
        <ResendVerificationForm initialEmail={registeredEmail} />
        <p className="text-center text-sm text-muted-foreground">
          <Link
            href="/login"
            className="font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:rounded-sm"
          >
            Back to login
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        {formError ? <AuthAlert>{formError}</AuthAlert> : null}
        <FormField label="Name" htmlFor="register-name" errors={fieldErrors.name}>
          <Input
            id="register-name"
            name="name"
            autoComplete="name"
            placeholder="Ada Lovelace"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </FormField>
        <FormField
          label="Email"
          htmlFor="register-email"
          errors={fieldErrors.email}
        >
          <Input
            id="register-email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </FormField>
        <FormField
          label="Password"
          htmlFor="register-password"
          errors={fieldErrors.password}
          hint="At least 8 characters."
        >
          <PasswordInput
            id="register-password"
            name="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </FormField>
        <FormField
          label="Company name"
          htmlFor="register-company-name"
          errors={fieldErrors.companyName}
        >
          <Input
            id="register-company-name"
            name="companyName"
            autoComplete="organization"
            placeholder="Acme Talent"
            value={companyName}
            onChange={(event) => setCompanyName(event.target.value)}
            required
          />
        </FormField>
        <Button type="submit" disabled={isPending} className="w-full">
          {isPending ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <UserPlus aria-hidden="true" />
          )}
          Create account
        </Button>
      </form>

      <p className="text-center text-xs text-muted-foreground">
        Joining an existing team? Ask an admin for an invite link.
      </p>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link
          href="/login"
          className="font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:rounded-sm"
        >
          Log in
        </Link>
      </p>
    </div>
  );
}

export { RegisterForm };
