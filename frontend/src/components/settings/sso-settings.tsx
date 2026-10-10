"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { SsoConnection } from "@/components/settings/sso-connection";
import { SsoDomains } from "@/components/settings/sso-domains";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { setSsoEnforcedAction } from "@/server/actions/sso";
import type { SsoSettings } from "@/server/queries/sso";

function Enforcement({
  enforced,
  canChange,
  onChange,
}: {
  enforced: boolean;
  canChange: boolean;
  onChange: (enforced: boolean) => void;
}) {
  const [isPending, startTransition] = useTransition();

  function toggle(next: boolean) {
    onChange(next);
    startTransition(async () => {
      const result = await setSsoEnforcedAction({ enforced: next });
      if (!result.ok) {
        onChange(!next);
        toast.error(result.error);
        return;
      }
      toast.success(
        next
          ? "SSO is now required. Password and Google sessions end on their next request."
          : "Members can use any sign-in method again.",
      );
    });
  }

  return (
    <div className="flex items-center justify-between gap-6">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">Require SSO for members</p>
        <p className="text-sm text-muted-foreground">
          {canChange
            ? "Everyone except owners must sign in through your identity provider. Owners keep their password so a broken IdP can't lock you out."
            : "Only an owner can change this."}
        </p>
      </div>
      <Switch
        checked={enforced}
        onCheckedChange={toggle}
        disabled={!canChange || isPending}
        aria-label="Require SSO for members"
      />
    </div>
  );
}

export function SsoSettingsPanel({ settings, isOwner }: { settings: SsoSettings; isOwner: boolean }) {
  const [enforced, setEnforced] = useState(settings.enforced);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Domains</CardTitle>
          <CardDescription>
            Prove you own your email domain. Your identity provider can only sign in addresses on a
            verified domain.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SsoDomains initialDomains={settings.domains} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Identity provider</CardTitle>
          <CardDescription>
            Create a SAML or OIDC app in your identity provider with the details below, then connect
            it here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SsoConnection
            initialConnection={settings.connection}
            enforced={enforced}
            serviceProvider={settings.serviceProvider}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Enforcement</CardTitle>
          <CardDescription>
            Needs a connected identity provider and at least one verified domain.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Enforcement enforced={enforced} canChange={isOwner} onChange={setEnforced} />
        </CardContent>
      </Card>
    </div>
  );
}
