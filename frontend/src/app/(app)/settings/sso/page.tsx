import type { Metadata } from "next";
import { ShieldCheck, ShieldOff } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SsoSettingsPanel } from "@/components/settings/sso-settings";
import { canAdmin, requireMember } from "@/lib/auth/guards";
import { getSsoEnforcement, getSsoSettings } from "@/server/queries/sso";

export const metadata: Metadata = { title: "SSO · Settings" };

async function MemberView() {
  const { enforced } = await getSsoEnforcement();
  const Icon = enforced ? ShieldCheck : ShieldOff;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Single sign-on</CardTitle>
        <CardDescription>Managed by your workspace admins.</CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-3">
        <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm text-foreground">
          {enforced
            ? "Your company requires signing in through its identity provider."
            : "Your company doesn't require single sign-on. Any sign-in method works."}
        </p>
      </CardContent>
    </Card>
  );
}

export default async function SettingsSsoPage() {
  const user = await requireMember();
  if (!canAdmin(user.role)) return <MemberView />;

  const settings = await getSsoSettings();
  if (!settings.available) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Single sign-on isn&apos;t enabled here</CardTitle>
          <CardDescription>
            This deployment has no SSO_ENCRYPTION_KEY, which protects stored identity-provider
            settings. Whoever runs this ResumeRank instance can set it (see .env.example) to turn SSO
            on.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return <SsoSettingsPanel settings={settings} isOwner={user.role === "OWNER"} />;
}
