"use client";

import { Loader2, Smartphone } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { CopyValue } from "@/components/settings/copy-value";
import { FormField } from "@/components/shared/form-field";
import { useActionForm } from "@/components/shared/use-action-form";
import { QrCode } from "@/components/mfa/qr-code";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { confirmTotpSchema } from "@resumerank/core/validators/mfa";
import { beginTotpEnrollmentAction, confirmTotpEnrollmentAction } from "@/server/actions/mfa";

type Enrollment = { secret: string; uri: string };

/** Groups the base32 secret in fours so it can be typed into an app without losing place. */
function grouped(secret: string): string {
  return secret.match(/.{1,4}/g)?.join(" ") ?? secret;
}

export function TotpSetup({ onAdded }: { onAdded: (recoveryCodes: string[] | null) => void }) {
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [isStarting, startTransition] = useTransition();
  const { fieldErrors, formError, isPending, submit } = useActionForm({
    schema: confirmTotpSchema,
    action: confirmTotpEnrollmentAction,
    onSuccess: ({ recoveryCodes }) => {
      toast.success("Authenticator app set up.");
      onAdded(recoveryCodes);
    },
  });

  function start() {
    startTransition(async () => {
      const result = await beginTotpEnrollmentAction();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setEnrollment(result.data);
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit({ code });
  }

  if (!enrollment) {
    return (
      <Button type="button" variant="outline" onClick={start} disabled={isStarting} className="w-fit">
        {isStarting ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Smartphone aria-hidden="true" />}
        Set up authenticator app
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm text-muted-foreground">
        <li>Open an authenticator app such as 1Password, Google Authenticator or Microsoft Authenticator.</li>
        <li>Scan the QR code, or enter the setup key by hand.</li>
        <li>Enter the 6-digit code the app shows.</li>
      </ol>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <QrCode value={enrollment.uri} label="QR code for your authenticator app" />
        <div className="min-w-0 flex-1">
          <CopyValue label="Setup key" value={grouped(enrollment.secret)} />
        </div>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-start" noValidate>
        <FormField
          label="Code from your app"
          htmlFor="totp-setup-code"
          errors={formError ? [formError] : fieldErrors.code}
          className="sm:w-56"
        >
          <Input
            id="totp-setup-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123 456"
            maxLength={7}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            className="font-mono tracking-widest"
            required
          />
        </FormField>
        <Button type="submit" disabled={isPending} className="sm:mt-6">
          {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          {isPending ? "Checking…" : "Turn on"}
        </Button>
      </form>
    </div>
  );
}
