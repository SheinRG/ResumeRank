"use client";

import { useRouter } from "next/navigation";
import { Loader2, UserPlus } from "lucide-react";
import { useState } from "react";

import { AuthAlert } from "@/components/auth/auth-alert";
import { PasswordInput } from "@/components/auth/password-input";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/shared/form-field";
import { Input } from "@/components/ui/input";
import { useActionForm } from "@/components/shared/use-action-form";
import { acceptInviteSchema } from "@resumerank/core/validators/company";
import { acceptInviteAction } from "@/server/actions/company";

function InviteSignupForm({ token, email }: { token: string; email: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const { fieldErrors, formError, isPending, submit } = useActionForm({
    schema: acceptInviteSchema,
    action: acceptInviteAction,
    onSuccess: () => router.push("/dashboard"),
  });

  function handleSubmit(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    submit({ token, name, password });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      {formError ? <AuthAlert>{formError}</AuthAlert> : null}
      <FormField label="Email" htmlFor="invite-email">
        <Input id="invite-email" value={email} readOnly />
      </FormField>
      <FormField label="Name" htmlFor="invite-name" errors={fieldErrors.name}>
        <Input
          id="invite-name"
          name="name"
          autoComplete="name"
          placeholder="Ada Lovelace"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
      </FormField>
      <FormField
        label="Password"
        htmlFor="invite-password"
        errors={fieldErrors.password}
        hint="At least 8 characters."
      >
        <PasswordInput
          id="invite-password"
          name="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </FormField>
      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <UserPlus aria-hidden="true" />
        )}
        Create account &amp; join
      </Button>
    </form>
  );
}

export { InviteSignupForm };
