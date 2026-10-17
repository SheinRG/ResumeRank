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
import type { PasswordPolicy } from "@resumerank/core/auth/password-policy";
import { acceptInviteSchemaFor } from "@resumerank/core/validators/company";
import { passwordHint } from "@/lib/password-hint";
import { acceptInviteAction } from "@/server/actions/company";

function InviteSignupForm({ token, email, policy }: { token: string; email: string; policy: PasswordPolicy }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const { fieldErrors, formError, isPending, submit } = useActionForm({
    schema: acceptInviteSchemaFor(policy.minLength),
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
        hint={passwordHint(policy)}
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
