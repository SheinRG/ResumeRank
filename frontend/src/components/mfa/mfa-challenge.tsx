"use client";

import { startAuthentication } from "@simplewebauthn/browser";
import { KeyRound, Loader2, LogOut, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { AuthAlert } from "@/components/auth/auth-alert";
import { passkeyErrorMessage } from "@/components/mfa/passkey-errors";
import { useWebAuthnSupport } from "@/components/mfa/passkey-setup";
import { FormField } from "@/components/shared/form-field";
import { useActionForm } from "@/components/shared/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { mfaCodeChallengeSchema } from "@resumerank/core/validators/mfa";
import { logoutAction } from "@/server/actions/auth";
import {
  beginPasskeyChallengeAction,
  verifyMfaCodeAction,
  verifyPasskeyChallengeAction,
} from "@/server/actions/mfa";
import type { MfaMethods } from "@/server/queries/mfa";

type CodeMethod = "totp" | "recovery";

const LOW_RECOVERY_CODES = 3;

function PasskeyButton({ onVerified, primary }: { onVerified: () => void; primary: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function verify() {
    setError(null);
    startTransition(async () => {
      const options = await beginPasskeyChallengeAction();
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
      const result = await verifyPasskeyChallengeAction({ response });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onVerified();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? <AuthAlert>{error}</AuthAlert> : null}
      <Button
        type="button"
        variant={primary ? "default" : "outline"}
        onClick={verify}
        disabled={isPending}
        className="w-full"
      >
        {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <KeyRound aria-hidden="true" />}
        {isPending ? "Waiting for your passkey…" : "Use a passkey"}
      </Button>
    </div>
  );
}

function CodeForm({ method, onVerified }: { method: CodeMethod; onVerified: (remaining: number | null) => void }) {
  const [code, setCode] = useState("");
  const { fieldErrors, formError, isPending, submit } = useActionForm({
    schema: mfaCodeChallengeSchema,
    action: verifyMfaCodeAction,
    onSuccess: ({ recoveryCodesRemaining }) => onVerified(recoveryCodesRemaining),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit({ method, code });
  }

  const isTotp = method === "totp";
  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      {formError ? <AuthAlert>{formError}</AuthAlert> : null}
      <FormField
        label={isTotp ? "Code from your authenticator app" : "Recovery code"}
        htmlFor="mfa-code"
        errors={fieldErrors.code}
      >
        <Input
          id="mfa-code"
          name="code"
          inputMode={isTotp ? "numeric" : "text"}
          autoComplete={isTotp ? "one-time-code" : "off"}
          autoCapitalize="none"
          spellCheck={false}
          placeholder={isTotp ? "123 456" : "abcd-efgh-ijkl-mnop"}
          maxLength={isTotp ? 7 : 24}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          className="font-mono tracking-widest"
          autoFocus
          required
        />
      </FormField>
      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
        Verify
      </Button>
    </form>
  );
}

export function MfaChallenge({ methods, next }: { methods: MfaMethods; next: string }) {
  const router = useRouter();
  const passkeySupported = useWebAuthnSupport();
  // Null means the passkey button is the main action.
  const [method, setMethod] = useState<CodeMethod | null>(
    methods.totp ? "totp" : methods.passkey ? null : "recovery",
  );

  function verified(recoveryCodesRemaining: number | null) {
    if (recoveryCodesRemaining !== null && recoveryCodesRemaining <= LOW_RECOVERY_CODES) {
      toast.warning(
        `You have ${recoveryCodesRemaining} recovery code${recoveryCodesRemaining === 1 ? "" : "s"} left. Generate new ones in Settings → Security.`,
      );
    }
    router.replace(next);
  }

  return (
    <div className="flex flex-col gap-6">
      {method ? <CodeForm key={method} method={method} onVerified={verified} /> : null}
      {methods.passkey && passkeySupported ? (
        <PasskeyButton primary={method === null} onVerified={() => verified(null)} />
      ) : null}
      {methods.passkey && !passkeySupported && method === null ? (
        <AuthAlert>This browser can&apos;t use passkeys. Use a recovery code, or sign in from another browser.</AuthAlert>
      ) : null}

      <div className="flex flex-col items-start gap-1">
        {methods.totp && method !== "totp" ? (
          <Button type="button" variant="link" className="h-11 px-0" onClick={() => setMethod("totp")}>
            Use your authenticator app
          </Button>
        ) : null}
        {methods.recoveryCodesRemaining > 0 && method !== "recovery" ? (
          <Button type="button" variant="link" className="h-11 px-0" onClick={() => setMethod("recovery")}>
            Use a recovery code
          </Button>
        ) : null}
      </div>

      <Separator />
      <div className="flex flex-col gap-3 text-sm text-muted-foreground">
        <p>Lost every method and your recovery codes? Ask a workspace admin to reset your two-factor authentication.</p>
        <form action={logoutAction}>
          <Button type="submit" variant="ghost" className="-ml-3">
            <LogOut aria-hidden="true" />
            Sign out
          </Button>
        </form>
      </div>
    </div>
  );
}
