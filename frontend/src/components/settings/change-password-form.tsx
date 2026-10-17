"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/auth/password-input";
import { FormField } from "@/components/shared/form-field";
import { useActionForm } from "@/components/shared/use-action-form";
import type { PasswordPolicy } from "@resumerank/core/auth/password-policy";
import { changePasswordSchemaFor } from "@resumerank/core/validators/user";
import { passwordHint } from "@/lib/password-hint";
import { changePasswordAction } from "@/server/actions/users";

export function ChangePasswordForm({
  policy,
  onChanged,
}: {
  policy: PasswordPolicy;
  /** Runs after the new password is saved; the settings page just clears the form. */
  onChanged?: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const { fieldErrors, isPending, submit } = useActionForm({
    schema: changePasswordSchemaFor(policy.minLength),
    action: changePasswordAction,
    onSuccess: () => {
      toast.success("Password updated.");
      setCurrent("");
      setNext("");
      onChanged?.();
    },
    onError: (message) => toast.error(message),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit({ currentPassword: current, newPassword: next });
  }

  return (
    <form onSubmit={handleSubmit} className="flex max-w-md flex-col gap-4">
      <FormField
        label="Current password"
        errors={fieldErrors.currentPassword}
        required
      >
        <PasswordInput
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
          autoComplete="current-password"
          required
        />
      </FormField>
      <FormField
        label="New password"
        errors={fieldErrors.newPassword}
        hint={passwordHint(policy)}
        required
      >
        <PasswordInput
          value={next}
          onChange={(event) => setNext(event.target.value)}
          autoComplete="new-password"
          required
        />
      </FormField>
      <Button type="submit" disabled={isPending} className="w-fit">
        {isPending ? "Updating…" : "Update password"}
      </Button>
    </form>
  );
}
