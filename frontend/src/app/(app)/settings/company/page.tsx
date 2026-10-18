import type { Metadata } from "next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { db } from "@resumerank/core/db";
import { CompanyForm } from "@/components/settings/company-form";
import { TransferOwnership } from "@/components/settings/transfer-ownership";
import { WorkspaceOffboarding } from "@/components/compliance/workspace-offboarding";
import { canAdmin, requireMember } from "@/lib/auth/guards";
import { formatNumber } from "@/lib/format";
import { getAiUsage, getCompany } from "@/server/queries/company";
import { listTeam } from "@/server/queries/users";

export const metadata: Metadata = { title: "Company · Settings" };

export default async function SettingsCompanyPage() {
  const user = await requireMember();
  const [company, aiUsage] = await Promise.all([getCompany(), getAiUsage()]);
  const canEdit = canAdmin(user.role);
  const isOwner = user.role === "OWNER";
  const [team, account] = isOwner
    ? await Promise.all([
        listTeam(),
        db.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } }),
      ])
    : [[], null];
  const successors = team.filter((member) => member.role !== "OWNER" && member.emailVerified);
  const usedPercent = Math.min(100, (aiUsage.used / aiUsage.budget) * 100);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Company</CardTitle>
          <CardDescription>
            {canEdit
              ? "Update your company's public profile."
              : "Your company's profile. Contact an admin to make changes."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CompanyForm company={company} canEdit={canEdit} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI usage</CardTitle>
          <CardDescription>
            Tokens spent on scoring and resume autofill over the last 30 days. AI requests pause
            when the budget is used up and resume as older usage ages out.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Progress value={usedPercent} aria-label="AI budget used" />
          <p className="font-mono text-xs text-muted-foreground">
            {formatNumber(aiUsage.used)} of {formatNumber(aiUsage.budget)} tokens used ·{" "}
            {formatNumber(aiUsage.remaining)} left
          </p>
        </CardContent>
      </Card>

      {isOwner ? (
        <Card>
          <CardHeader>
            <CardTitle>Transfer ownership</CardTitle>
            <CardDescription>
              Leaving the company or handing it over? Make a teammate the owner instead of
              promoting and demoting by hand.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TransferOwnership
              companyName={company.name}
              candidates={successors}
              hasPassword={Boolean(account?.passwordHash)}
            />
          </CardContent>
        </Card>
      ) : null}

      {isOwner ? <WorkspaceOffboarding companyName={company.name} /> : null}
    </div>
  );
}
