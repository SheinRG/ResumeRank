import type { Metadata } from "next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TeamTable } from "@/components/settings/team-table";
import { canAdmin, requireUser } from "@/lib/auth/guards";
import { listTeam } from "@/server/queries/users";

export const metadata: Metadata = { title: "Team · Settings" };

export default async function SettingsTeamPage() {
  const user = await requireUser();
  const members = await listTeam();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Team</CardTitle>
        <CardDescription>
          {members.length} member{members.length === 1 ? "" : "s"} in your workspace.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <TeamTable
          members={members}
          currentUserId={user.id}
          canManage={canAdmin(user.role)}
        />
      </CardContent>
    </Card>
  );
}
