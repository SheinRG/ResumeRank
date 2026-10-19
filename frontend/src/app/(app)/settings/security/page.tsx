import type { Metadata } from "next";

import { SecuritySettings } from "@/components/mfa/security-settings";
import { ActiveSessions } from "@/components/settings/active-sessions";
import { IpAllowlistCard } from "@/components/settings/ip-allowlist";
import { PasswordPolicyCard } from "@/components/settings/password-policy";
import { SessionPolicyCard } from "@/components/settings/session-policy";
import { SupportAccessCard } from "@/components/settings/support-access";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser, type CurrentUser } from "@/lib/auth/guards";
import { getIpAllowlist } from "@/server/queries/ip-allowlist";
import { getMfaPolicy, getMfaStatus } from "@/server/queries/mfa";
import { getPasswordPolicy } from "@/server/queries/password-policy";
import { getLoginSessions, getSessionPolicy } from "@/server/queries/sessions";
import { getSupportAccess } from "@/server/queries/support-access";

export const metadata: Metadata = { title: "Security · Settings" };

/** Someone's own second factors and sign-ins; a support session sees the workspace's policies only. */
async function PersonalSecurity({ isOwner }: { isOwner: boolean }) {
  const [status, policy, sessions] = await Promise.all([getMfaStatus(), getMfaPolicy(), getLoginSessions()]);
  return (
    <SecuritySettings status={status} policy={policy} isOwner={isOwner}>
      <ActiveSessions sessions={sessions} />
    </SecuritySettings>
  );
}

function SupportSessionNotice({ user }: { user: CurrentUser }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Personal security</CardTitle>
        <CardDescription>
          {user.name}&apos;s two-factor methods and sign-ins aren&apos;t shown in a support session.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

export default async function SettingsSecurityPage() {
  const user = await requireUser();
  const [sessionPolicy, passwordPolicy, ipAllowlist, supportAccess] = await Promise.all([
    getSessionPolicy(),
    getPasswordPolicy(),
    getIpAllowlist(),
    getSupportAccess(),
  ]);
  const isOwner = user.role === "OWNER";

  return (
    <div className="flex flex-col gap-6">
      {user.supportSession ? <SupportSessionNotice user={user} /> : <PersonalSecurity isOwner={isOwner} />}
      {sessionPolicy ? <SessionPolicyCard policy={sessionPolicy} canChange={isOwner} /> : null}
      {passwordPolicy ? <PasswordPolicyCard policy={passwordPolicy} canChange={isOwner} /> : null}
      {ipAllowlist ? <IpAllowlistCard panel={ipAllowlist} /> : null}
      {supportAccess ? <SupportAccessCard access={supportAccess} canChange={isOwner} /> : null}
    </div>
  );
}
