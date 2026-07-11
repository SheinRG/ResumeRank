"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleCheckBig, KeyRound, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";

import { AuthAlert } from "@/components/auth/auth-alert";
import { PasswordInput } from "@/components/auth/password-input";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/shared/form-field";
import { resetPasswordSchema } from "@/lib/validators/auth";
import { resetPasswordAction } from "@/server/actions/auth";

type ResetPasswordFormProps = {
  token?: string;
};

function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (!token) {
    return (
      <div className="flex flex-col gap-4">
        <AuthAlert>
          This reset link is missing its token. Request a new one to
          continue.
        </AuthAlert>
        <Button asChild className="w-full">
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
      </div>
    );
  }

  if (succeeded) {
    return (
      <div className="flex flex-col items-center gap-4 py-2 text-center">
        <CircleCheckBig className="size-10 text-emerald-600" aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <p className="text-base font-medium">Password updated</p>
          <p className="text-sm text-muted-foreground">
            Sign in with your new password.
          </p>
        </div>
        <Button className="w-full" onClick={() => router.push("/login")}>
          Sign in
        </Button>
      </div>
    );
  }

  function handleSubmit(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setFormError(null);
    setFieldError(null);

    const parsed = resetPasswordSchema.safeParse({ token, password });
    if (!parsed.success) {
      setFieldError(parsed.error.flatten().fieldErrors.password?.[0] ?? null);
      return;
    }

    startTransition(async () => {
      const result = await resetPasswordAction(parsed.data);
      if (!result.ok) {
        setFieldError(result.fieldErrors?.password?.[0] ?? null);
        setFormError(result.fieldErrors?.password ? null : result.error);
        return;
      }
      setSucceeded(true);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      {formError ? (
        <div className="flex flex-col gap-2">
          <AuthAlert>{formError}</AuthAlert>
          <Link
            href="/forgot-password"
            className="text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:rounded-sm"
          >
            Request a new link
          </Link>
        </div>
      ) : null}
      <FormField
        label="New password"
        htmlFor="reset-password"
        errors={fieldError ? [fieldError] : undefined}
        hint="At least 8 characters."
      >
        <PasswordInput
          id="reset-password"
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
          <KeyRound aria-hidden="true" />
        )}
        Reset password
      </Button>
    </form>
  );
}

export { ResetPasswordForm };
