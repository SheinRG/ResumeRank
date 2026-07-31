import type { Metadata } from "next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TeamTable } from "@/components/settings/team-table";
import { TeamInvites } from "@/components/settings/team-invites";
import { canAdmin, requireUser } from "@/lib/auth/guards";
import { listPendingInvites, listTeam } from "@/server/queries/users";

export const metadata: Metadata = { title: "Team · Settings" };

export default async function SettingsTeamPage() {
  const user = await requireUser();
  const members = await listTeam();
  const canManage = canAdmin(user.role);
  const invites = canManage ? await listPendingInvites() : [];

  return (
    <div className="flex flex-col gap-6">
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
            canManage={canManage}
          />
        </CardContent>
      </Card>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>Invite teammates</CardTitle>
            <CardDescription>
              Send an email invite so someone can join your workspace.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TeamInvites initialInvites={invites} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
