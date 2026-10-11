import type { Metadata } from "next";

import { SecuritySettings } from "@/components/mfa/security-settings";
import { requireUser } from "@/lib/auth/guards";
import { getMfaPolicy, getMfaStatus } from "@/server/queries/mfa";

export const metadata: Metadata = { title: "Security · Settings" };

export default async function SettingsSecurityPage() {
  const user = await requireUser();
  const [status, policy] = await Promise.all([getMfaStatus(), getMfaPolicy()]);

  return <SecuritySettings status={status} policy={policy} isOwner={user.role === "OWNER"} />;
}
