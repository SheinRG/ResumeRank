import type { Metadata } from "next";
import Link from "next/link";

import { AuditExport } from "@/components/audit/audit-export";
import { AuditIntegrity } from "@/components/audit/audit-integrity";
import { AuditRetention } from "@/components/audit/audit-retention";
import { AuditStreamCard } from "@/components/audit/audit-stream";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { canAdmin, requireMember } from "@/lib/auth/guards";
import { getAuditSettings } from "@/server/queries/audit";

export const metadata: Metadata = { title: "Audit log · Settings" };

function MemberView() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit log</CardTitle>
        <CardDescription>Exports, retention and streaming are managed by your workspace admins.</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-foreground">
          Changes across the workspace are on the{" "}
          <Link href="/activity" className="font-medium underline underline-offset-4">
            Activity
          </Link>{" "}
          page.
        </p>
      </CardContent>
    </Card>
  );
}

export default async function SettingsAuditPage() {
  const user = await requireMember();
  if (!canAdmin(user.role)) return <MemberView />;

  const settings = await getAuditSettings();
  const isOwner = user.role === "OWNER";

  return (
    <div className="flex flex-col gap-6">
      <AuditIntegrity latestSeq={settings.latestSeq} />
      <AuditExport />
      <AuditRetention retentionDays={settings.retentionDays} canChange={isOwner} />
      <AuditStreamCard initialStream={settings.stream} canChange={isOwner} />
    </div>
  );
}
