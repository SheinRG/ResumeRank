"use client";

import { startAuthentication } from "@simplewebauthn/browser";
import { KeyRound, Loader2, LogOut, RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useState, useTransition, type FormEvent } from "react";

import { AuthAlert } from "@/components/auth/auth-alert";
import { PasswordInput } from "@/components/auth/password-input";
import { passkeyErrorMessage } from "@/components/mfa/passkey-errors";
import { FormField } from "@/components/shared/form-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ReauthMethods } from "@resumerank/core/auth/step-up";
import { reauthSchema, type ReauthInput } from "@resumerank/core/validators/step-up";
import { logoutAction } from "@/server/actions/auth";
import {
  beginReauthPasskeyAction,
  getReauthMethodsAction,
  reauthenticateAction,
} from "@/server/actions/step-up";

type Method = keyof ReauthMethods;

/** Sends one attempt; resolves to field errors for the form that sent it, if any. The server parses the input again. */
type Submit = (input: ReauthInput | { method: "passkey"; response: unknown }) => Promise<string[] | undefined>;

const METHOD_LABELS: Record<Method, string> = {
  password: "Password",
  totp: "Authenticator app",
  passkey: "Passkey",
};

function PasswordForm({ onSubmit }: { onSubmit: Submit }) {
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<string[] | undefined>();
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = reauthSchema.safeParse({ method: "password", password });
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((issue) => issue.message));
      return;
    }
    startTransition(async () => setErrors(await onSubmit(parsed.data)));
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <FormField label="Password" htmlFor="step-up-password" errors={errors}>
        <PasswordInput
          id="step-up-password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </FormField>
      <Button type="submit" disabled={isPending}>
        {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
        Confirm
      </Button>
    </form>
  );
}

function CodeForm({ onSubmit }: { onSubmit: Submit }) {
  const [code, setCode] = useState("");
  const [errors, setErrors] = useState<string[] | undefined>();
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = reauthSchema.safeParse({ method: "totp", code });
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((issue) => issue.message));
      return;
    }
    startTransition(async () => setErrors(await onSubmit(parsed.data)));
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <FormField label="6-digit code" htmlFor="step-up-code" errors={errors}>
        <Input
          id="step-up-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus
          className="font-mono tracking-widest"
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
      </FormField>
      <Button type="submit" disabled={isPending}>
        {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
        Confirm
      </Button>
    </form>
  );
}

function PasskeyButton({ onSubmit }: { onSubmit: Submit }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function verify() {
    setError(null);
    startTransition(async () => {
      const options = await beginReauthPasskeyAction();
      if (!options.ok) {
        setError(options.error);
        return;
      }
      let response;
      try {
        response = await startAuthentication({ optionsJSON: options.data });
      } catch (cause) {
        setError(passkeyErrorMessage(cause, "verify"));
        return;
      }
      const errors = await onSubmit({ method: "passkey", response });
      if (errors) setError(errors[0] ?? null);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? <AuthAlert>{error}</AuthAlert> : null}
      <Button type="button" onClick={verify} disabled={isPending}>
        {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <KeyRound aria-hidden="true" />}
        Use a passkey
      </Button>
    </div>
  );
}

type MethodsState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; methods: ReauthMethods };

export default function StepUpDialog({ open, onDone }: { open: boolean; onDone: (confirmed: boolean) => void }) {
  const [state, setState] = useState<MethodsState>({ status: "loading" });
  const [formError, setFormError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Each opening mounts a fresh dialog (the provider keys it), so this only fills in what it loaded.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getReauthMethodsAction().then((result) => {
      if (cancelled) return;
      setState(result.ok ? { status: "ready", methods: result.data } : { status: "error", message: result.error });
    });
    return () => {
      cancelled = true;
    };
  }, [open, attempt]);

  /** Field errors go back to the form that sent them; anything else shows above the tabs. */
  const submit: Submit = async (input) => {
    setFormError(null);
    const result = await reauthenticateAction(input);
    if (result.ok) {
      onDone(true);
      return undefined;
    }
    const fieldErrors = result.fieldErrors ? Object.values(result.fieldErrors).flat() : [];
    if (fieldErrors.length > 0) return fieldErrors;
    setFormError(result.error);
    return undefined;
  };

  const available =
    state.status === "ready" ? (Object.keys(METHOD_LABELS) as Method[]).filter((method) => state.methods[method]) : [];

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onDone(false))}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Confirm it&apos;s you</DialogTitle>
          <DialogDescription>
            This is a sensitive change, and you signed in a while ago. Confirm it&apos;s you to continue;
            you won&apos;t be asked again for a few minutes.
          </DialogDescription>
        </DialogHeader>

        {state.status === "loading" ? (
          <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading">
            <Skeleton className="h-9 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-11 w-full rounded-full" />
          </div>
        ) : state.status === "error" ? (
          <div className="flex flex-col gap-3">
            <AuthAlert>{state.message}</AuthAlert>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setState({ status: "loading" });
                setAttempt((count) => count + 1);
              }}
            >
              <RefreshCw aria-hidden="true" />
              Try again
            </Button>
          </div>
        ) : available.length === 0 ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Your account signs in through single sign-on or Google, so confirm it&apos;s you by signing
              in again, then repeat the change.
            </p>
            <form action={logoutAction}>
              <Button type="submit" className="w-full">
                <LogOut aria-hidden="true" />
                Sign out and sign in again
              </Button>
            </form>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {formError ? <AuthAlert>{formError}</AuthAlert> : null}
            <Tabs defaultValue={available[0]}>
              {available.length > 1 ? (
                <TabsList className="w-full">
                  {available.map((method) => (
                    <TabsTrigger key={method} value={method} className="flex-1">
                      {METHOD_LABELS[method]}
                    </TabsTrigger>
                  ))}
                </TabsList>
              ) : null}
              <TabsContent value="password" className="pt-2">
                <PasswordForm onSubmit={submit} />
              </TabsContent>
              <TabsContent value="totp" className="pt-2">
                <CodeForm onSubmit={submit} />
              </TabsContent>
              <TabsContent value="passkey" className="pt-2">
                <PasskeyButton onSubmit={submit} />
              </TabsContent>
            </Tabs>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
