"use client";

import { KeyRound, RefreshCw, ShieldCheck, ShieldOff, Smartphone, Trash2 } from "lucide-react";
import { useState, useTransition, type ComponentProps, type ReactNode } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/mfa/confirm-dialog";
import { PasskeySetup } from "@/components/mfa/passkey-setup";
import { RecoveryCodes } from "@/components/mfa/recovery-codes";
import { TotpSetup } from "@/components/mfa/totp-setup";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useStepUp } from "@/components/step-up/step-up-provider";
import { formatDate, formatRelative } from "@/lib/format";
import {
  regenerateRecoveryCodesAction,
  removePasskeyAction,
  removeTotpAction,
  setMfaRequiredAction,
} from "@/server/actions/mfa";
import type { MfaPolicy, MfaStatus } from "@/server/queries/mfa";

function lastFactorWarning(status: MfaStatus): string {
  return status.required
    ? "Your workspace requires two-factor authentication, so this can only be removed while you have another method."
    : "It's your only method, so two-factor authentication turns off and your recovery codes stop working.";
}

function factorCount(status: MfaStatus): number {
  return (status.totpConfirmedAt ? 1 : 0) + status.passkeys.length;
}

function MethodRow({
  icon: Icon,
  title,
  detail,
  action,
}: {
  icon: typeof KeyRound;
  title: string;
  detail: string;
  action: ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border p-4">
      <div className="flex min-w-0 items-center gap-3">
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium text-foreground">{title}</span>
          <span className="font-mono text-xs text-muted-foreground">{detail}</span>
        </div>
      </div>
      {action}
    </li>
  );
}

/** Spreads its props: it is a dialog trigger, which hands it the open handler and ARIA state. */
function RemoveButton({ label, ...props }: { label: string } & ComponentProps<typeof Button>) {
  return (
    <Button type="button" variant="ghost" size="icon" className="size-11" aria-label={label} {...props}>
      <Trash2 aria-hidden="true" />
    </Button>
  );
}

function TwoFactorCard({ status }: { status: MfaStatus }) {
  const [freshCodes, setFreshCodes] = useState<string[] | null>(null);
  const withStepUp = useStepUp();
  const enabled = status.enabledAt !== null;
  const onlyOne = factorCount(status) === 1;

  function handleAdded(recoveryCodes: string[] | null) {
    if (recoveryCodes) setFreshCodes(recoveryCodes);
  }

  async function removeTotp(): Promise<boolean> {
    const result = await withStepUp(() => removeTotpAction());
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    toast.success(
      result.data.enabledAt ? "Authenticator app removed." : "Two-factor authentication is off.",
    );
    return true;
  }

  async function removePasskey(passkeyId: string, name: string): Promise<boolean> {
    const result = await withStepUp(() => removePasskeyAction({ passkeyId }));
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    toast.success(
      result.data.enabledAt ? `Passkey "${name}" removed.` : "Two-factor authentication is off.",
    );
    return true;
  }

  async function regenerate(): Promise<boolean> {
    const result = await withStepUp(() => regenerateRecoveryCodesAction());
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    setFreshCodes(result.data.recoveryCodes);
    return true;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-3">
          <CardTitle>Two-factor authentication</CardTitle>
          {enabled ? (
            <Badge variant="outline" className="border-verdict-strong/40 text-verdict-strong">
              <ShieldCheck aria-hidden="true" />
              On
            </Badge>
          ) : (
            <Badge variant="outline">
              <ShieldOff aria-hidden="true" />
              Off
            </Badge>
          )}
        </div>
        <CardDescription>
          {enabled && status.enabledAt
            ? `On since ${formatDate(status.enabledAt)}. Signing in with a password or Google also asks for one of the methods below.`
            : "Add a second step to signing in with a password or Google, so a stolen password alone can't get into your account."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {freshCodes ? (
          // A CSS fade rather than the motion wrappers: framer-motion would
          // add ~40 KB to this page for a single entrance.
          <div className="duration-200 motion-safe:animate-in motion-safe:fade-in-0">
            <RecoveryCodes codes={freshCodes} onDone={() => setFreshCodes(null)} />
          </div>
        ) : null}

        <section className="flex flex-col gap-3" aria-labelledby="mfa-app-heading">
          <h3 id="mfa-app-heading" className="text-sm font-semibold text-foreground">
            Authenticator app
          </h3>
          {status.totpConfirmedAt ? (
            <ul>
              <MethodRow
                icon={Smartphone}
                title="Authenticator app"
                detail={`Added ${formatDate(status.totpConfirmedAt)}`}
                action={
                  <ConfirmDialog
                    trigger={<RemoveButton label="Remove authenticator app" />}
                    title="Remove your authenticator app?"
                    description={
                      onlyOne
                        ? lastFactorWarning(status)
                        : "Codes from the app stop working. Your passkeys keep working."
                    }
                    confirmLabel="Remove app"
                    pendingLabel="Removing…"
                    onConfirm={removeTotp}
                  />
                }
              />
            </ul>
          ) : (
            <TotpSetup onAdded={handleAdded} />
          )}
        </section>

        <Separator />

        <section className="flex flex-col gap-3" aria-labelledby="mfa-passkeys-heading">
          <h3 id="mfa-passkeys-heading" className="text-sm font-semibold text-foreground">
            Passkeys and security keys
          </h3>
          {status.passkeys.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {status.passkeys.map((passkey) => (
                <MethodRow
                  key={passkey.id}
                  icon={KeyRound}
                  title={passkey.name}
                  detail={[
                    passkey.backedUp ? "Synced passkey" : "Single device",
                    passkey.lastUsedAt
                      ? `used ${formatRelative(passkey.lastUsedAt)}`
                      : `added ${formatDate(passkey.createdAt)}`,
                  ].join(" · ")}
                  action={
                    <ConfirmDialog
                      trigger={<RemoveButton label={`Remove passkey ${passkey.name}`} />}
                      title={`Remove "${passkey.name}"?`}
                      description={
                        onlyOne
                          ? lastFactorWarning(status)
                          : "This passkey stops working for ResumeRank. Delete it from the device too if you no longer need it."
                      }
                      confirmLabel="Remove passkey"
                      pendingLabel="Removing…"
                      onConfirm={() => removePasskey(passkey.id, passkey.name)}
                    />
                  }
                />
              ))}
            </ul>
          ) : null}
          <PasskeySetup onAdded={handleAdded} />
        </section>

        {enabled ? (
          <>
            <Separator />
            <section className="flex flex-col gap-3" aria-labelledby="mfa-recovery-heading">
              <h3 id="mfa-recovery-heading" className="text-sm font-semibold text-foreground">
                Recovery codes
              </h3>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  <span className="font-mono text-foreground">{status.recoveryCodesRemaining}</span> of 10
                  unused. Each signs you in once without your app or passkey.
                </p>
                <ConfirmDialog
                  trigger={
                    <Button type="button" variant="outline">
                      <RefreshCw aria-hidden="true" />
                      Generate new codes
                    </Button>
                  }
                  title="Generate new recovery codes?"
                  description="Your current codes stop working straight away. Save the new ones somewhere safe."
                  confirmLabel="Generate new codes"
                  pendingLabel="Generating…"
                  destructive={false}
                  onConfirm={regenerate}
                />
              </div>
            </section>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PolicyCard({ policy, canChange }: { policy: MfaPolicy; canChange: boolean }) {
  const [required, setRequired] = useState(policy.required);
  const [isPending, startTransition] = useTransition();
  const withStepUp = useStepUp();

  function toggle(next: boolean) {
    setRequired(next);
    startTransition(async () => {
      const result = await withStepUp(() => setMfaRequiredAction({ required: next }));
      if (!result.ok) {
        setRequired(!next);
        toast.error(result.error);
        return;
      }
      toast.success(
        next
          ? "Two-factor authentication is now required. Members without it set it up on their next visit."
          : "Two-factor authentication is optional again.",
      );
    });
  }

  const without = policy.membersWithoutMfa;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Two-factor policy</CardTitle>
        <CardDescription>
          Members who sign in through your company&apos;s SSO are covered by your identity provider
          instead.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-6">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-foreground">Require two-factor authentication</p>
          <p className="text-sm text-muted-foreground">
            {canChange
              ? `Everyone, owners included, must add a second factor before using the workspace. ${
                  without === 0
                    ? "Every member already has one."
                    : `${without} member${without === 1 ? " doesn't" : "s don't"} have one yet.`
                }`
              : "Only an owner can change this."}
          </p>
        </div>
        <Switch
          checked={required}
          onCheckedChange={toggle}
          disabled={!canChange || isPending}
          aria-label="Require two-factor authentication"
        />
      </CardContent>
    </Card>
  );
}

/** `children` sit between the personal two-factor card and the workspace policy. */
export function SecuritySettings({
  status,
  policy,
  isOwner,
  children,
}: {
  status: MfaStatus;
  policy: MfaPolicy | null;
  isOwner: boolean;
  children?: ReactNode;
}) {
  return (
    <>
      <TwoFactorCard status={status} />
      {children}
      {policy ? <PolicyCard policy={policy} canChange={isOwner} /> : null}
    </>
  );
}
