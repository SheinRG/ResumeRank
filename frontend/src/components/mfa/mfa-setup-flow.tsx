"use client";

import { ArrowRight, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { PasskeySetup } from "@/components/mfa/passkey-setup";
import { RecoveryCodes } from "@/components/mfa/recovery-codes";
import { TotpSetup } from "@/components/mfa/totp-setup";
import { FadeIn } from "@/components/motion";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { logoutAction } from "@/server/actions/auth";

/**
 * The page a company's MFA requirement holds someone on until they add a
 * first factor. `complete` turns true when the server sees a factor, which
 * happens in the same response that adds it, so the codes stay in state
 * across that re-render and are shown before moving on.
 */
export function MfaSetupFlow({ next, complete }: { next: string; complete: boolean }) {
  const router = useRouter();
  const [codes, setCodes] = useState<string[] | null>(null);

  function handleAdded(recoveryCodes: string[] | null) {
    if (recoveryCodes) setCodes(recoveryCodes);
    else router.replace(next);
  }

  if (codes) {
    return (
      <FadeIn>
        <RecoveryCodes codes={codes} onDone={() => router.replace(next)} />
      </FadeIn>
    );
  }

  if (complete) {
    return (
      <Button type="button" onClick={() => router.replace(next)} className="w-fit">
        Continue
        <ArrowRight aria-hidden="true" />
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3" aria-labelledby="setup-app-heading">
        <h2 id="setup-app-heading" className="text-sm font-semibold text-foreground">
          Authenticator app
        </h2>
        <TotpSetup onAdded={handleAdded} />
      </section>
      <div className="flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="text-xs text-muted-foreground">or</span>
        <Separator className="flex-1" />
      </div>
      <section className="flex flex-col gap-3" aria-labelledby="setup-passkey-heading">
        <h2 id="setup-passkey-heading" className="text-sm font-semibold text-foreground">
          Passkey or security key
        </h2>
        <PasskeySetup onAdded={handleAdded} />
      </section>
      <Separator />
      <form action={logoutAction}>
        <Button type="submit" variant="ghost" className="-ml-3">
          <LogOut aria-hidden="true" />
          Sign out
        </Button>
      </form>
    </div>
  );
}
