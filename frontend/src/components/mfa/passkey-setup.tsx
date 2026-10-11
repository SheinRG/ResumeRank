"use client";

import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import { KeyRound, Loader2 } from "lucide-react";
import { useState, useSyncExternalStore, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { passkeyErrorMessage } from "@/components/mfa/passkey-errors";
import { FormField } from "@/components/shared/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { passkeyNameSchema } from "@resumerank/core/validators/mfa";
import { beginPasskeyRegistrationAction, finishPasskeyRegistrationAction } from "@/server/actions/mfa";

const subscribeNever = () => () => {};

/** False on the server and in browsers without WebAuthn; read once, it never changes. */
export function useWebAuthnSupport(): boolean {
  return useSyncExternalStore(subscribeNever, browserSupportsWebAuthn, () => false);
}

export function PasskeySetup({ onAdded }: { onAdded: (recoveryCodes: string[] | null) => void }) {
  const supported = useWebAuthnSupport();
  const [name, setName] = useState("");
  const [nameErrors, setNameErrors] = useState<string[] | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const parsed = passkeyNameSchema.safeParse(name);
    if (!parsed.success) {
      setNameErrors(parsed.error.issues.map((issue) => issue.message));
      return;
    }
    setNameErrors(undefined);

    startTransition(async () => {
      const options = await beginPasskeyRegistrationAction();
      if (!options.ok) {
        setError(options.error);
        return;
      }
      let response;
      try {
        response = await startRegistration({ optionsJSON: options.data });
      } catch (cause) {
        setError(passkeyErrorMessage(cause, "register"));
        return;
      }
      const result = await finishPasskeyRegistrationAction({ name: parsed.data, response });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setName("");
      toast.success(`Passkey "${parsed.data}" added.`);
      onAdded(result.data.recoveryCodes);
    });
  }

  if (!supported) {
    return (
      <p className="text-sm text-muted-foreground">
        This browser doesn&apos;t support passkeys. Use an authenticator app, or add a passkey from
        another browser.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-start" noValidate>
      <FormField
        label="Passkey name"
        htmlFor="passkey-name"
        errors={nameErrors ?? (error ? [error] : undefined)}
        hint="So you can tell it apart later, e.g. “Work laptop” or “YubiKey”."
        className="flex-1"
      >
        <Input
          id="passkey-name"
          value={name}
          maxLength={60}
          onChange={(event) => setName(event.target.value)}
          placeholder="Work laptop"
          required
        />
      </FormField>
      <Button type="submit" variant="outline" disabled={isPending} className="sm:mt-6">
        {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <KeyRound aria-hidden="true" />}
        Add passkey
      </Button>
    </form>
  );
}
