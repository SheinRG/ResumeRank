"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, LogIn } from "lucide-react";
import { useState, useTransition } from "react";

import { AuthAlert } from "@/components/auth/auth-alert";
import { GoogleSignInButton } from "@/components/auth/google-signin-button";
import { PasswordInput } from "@/components/auth/password-input";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/shared/form-field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { loginSchema } from "@/lib/validators/auth";
import { loginAction } from "@/server/actions/auth";
import type { ActionResult } from "@/types/action";

type LoginFormProps = {
  next: string;
  googleEnabled: boolean;
};

function LoginForm({ next, googleEnabled }: LoginFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<"email" | "password", string[]>>
  >({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setFormError(null);

    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setFieldErrors(parsed.error.flatten().fieldErrors);
      return;
    }
    setFieldErrors({});

    startTransition(async () => {
      const result: ActionResult<undefined> = await loginAction(parsed.data);
      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {});
        setFormError(result.error);
        return;
      }
      router.push(next);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        {formError ? <AuthAlert>{formError}</AuthAlert> : null}
        <FormField label="Email" htmlFor="login-email" errors={fieldErrors.email}>
          <Input
            id="login-email"
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
          htmlFor="login-password"
          errors={fieldErrors.password}
        >
          <PasswordInput
            id="login-password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </FormField>
        <div className="flex justify-end">
          <Link
            href="/forgot-password"
            className="text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:rounded-sm"
          >
            Forgot password?
          </Link>
        </div>
        <Button type="submit" disabled={isPending} className="w-full">
          {isPending ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <LogIn aria-hidden="true" />
          )}
          Log in
        </Button>
      </form>

      {googleEnabled ? (
        <>
          <div className="flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-xs text-muted-foreground">or</span>
            <Separator className="flex-1" />
          </div>
          <GoogleSignInButton next={next} />
        </>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Demo: demo@resumerank.app / demo1234
      </p>

      <p className="text-center text-sm text-muted-foreground">
        Need an account?{" "}
        <Link
          href="/register"
          className="font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:rounded-sm"
        >
          Create account
        </Link>
      </p>
    </div>
  );
}

export { LoginForm };
