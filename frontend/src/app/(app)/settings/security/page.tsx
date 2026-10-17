import type { Metadata } from "next";

import { SecuritySettings } from "@/components/mfa/security-settings";
import { ActiveSessions } from "@/components/settings/active-sessions";
import { IpAllowlistCard } from "@/components/settings/ip-allowlist";
import { SessionPolicyCard } from "@/components/settings/session-policy";
import { requireUser } from "@/lib/auth/guards";
import { getIpAllowlist } from "@/server/queries/ip-allowlist";
import { getMfaPolicy, getMfaStatus } from "@/server/queries/mfa";
import { getLoginSessions, getSessionPolicy } from "@/server/queries/sessions";

export const metadata: Metadata = { title: "Security · Settings" };

export default async function SettingsSecurityPage() {
  const user = await requireUser();
  const [status, policy, sessions, sessionPolicy, ipAllowlist] = await Promise.all([
    getMfaStatus(),
    getMfaPolicy(),
    getLoginSessions(),
    getSessionPolicy(),
    getIpAllowlist(),
  ]);
  const isOwner = user.role === "OWNER";

  return (
    <div className="flex flex-col gap-6">
      <SecuritySettings status={status} policy={policy} isOwner={isOwner}>
        <ActiveSessions sessions={sessions} />
      </SecuritySettings>
      {sessionPolicy ? <SessionPolicyCard policy={sessionPolicy} canChange={isOwner} /> : null}
      {ipAllowlist ? <IpAllowlistCard panel={ipAllowlist} /> : null}
    </div>
  );
}
