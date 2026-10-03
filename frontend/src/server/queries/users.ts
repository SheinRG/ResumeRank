import { requireMember, tenantContext } from "@/lib/auth/guards";
import * as team from "@resumerank/core/services/team";

export type { PendingInvite, TeamMember } from "@resumerank/core/services/team";

export async function listTeam(): Promise<team.TeamMember[]> {
  const user = await requireMember();
  return team.listTeam(tenantContext(user));
}

export async function listPendingInvites(): Promise<team.PendingInvite[]> {
  const user = await requireMember();
  return team.listPendingInvites(tenantContext(user));
}
