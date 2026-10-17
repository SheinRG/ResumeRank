"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { SsoConnection } from "@/components/settings/sso-connection";
import { SsoDirectory } from "@/components/settings/sso-directory";
import { SsoDomains } from "@/components/settings/sso-domains";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useStepUp } from "@/components/step-up/step-up-provider";
import { setSsoEnforcedAction } from "@/server/actions/sso";
import type { FeatureSet } from "@/server/queries/features";
import type { DirectorySummary, SsoSettings } from "@/server/queries/sso";

function Enforcement({
  enforced,
  canChange,
  entitled,
  onChange,
}: {
  enforced: boolean;
  canChange: boolean;
  /** Without it SSO can still be made optional, never required. */
  entitled: boolean;
  onChange: (enforced: boolean) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const withStepUp = useStepUp();

  function toggle(next: boolean) {
    onChange(next);
    startTransition(async () => {
      const result = await withStepUp(() => setSsoEnforcedAction({ enforced: next }));
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
          {!canChange
            ? "Only an owner can change this."
            : entitled || enforced
              ? "Everyone except owners must sign in through your identity provider. Owners keep their password so a broken IdP can't lock you out."
              : "Single sign-on isn't available to this workspace."}
        </p>
      </div>
      <Switch
        checked={enforced}
        onCheckedChange={toggle}
        disabled={!canChange || isPending || (!entitled && !enforced)}
        aria-label="Require SSO for members"
      />
    </div>
  );
}

export function SsoSettingsPanel({
  settings,
  directory,
  features,
  upgradable,
  isOwner,
}: {
  settings: SsoSettings;
  directory: DirectorySummary | null;
  features: FeatureSet;
  /** Billing is on, so a missing feature comes with a plan. */
  upgradable: boolean;
  isOwner: boolean;
}) {
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
            entitled={features.sso}
            upgradable={upgradable}
            serviceProvider={settings.serviceProvider}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Directory sync (SCIM)</CardTitle>
          <CardDescription>
            Let your identity provider add people when they join and remove them when they leave.
            Only addresses on verified domains are provisioned; owners are never removed
            automatically. While it&apos;s connected, the directory alone decides who joins.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SsoDirectory
            initialDirectory={directory}
            entitled={features["directory-sync"]}
            upgradable={upgradable}
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
          <Enforcement enforced={enforced} canChange={isOwner} entitled={features.sso} onChange={setEnforced} />
        </CardContent>
      </Card>
    </div>
  );
}
