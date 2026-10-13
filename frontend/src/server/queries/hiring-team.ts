import { requireMember, tenantContext } from "@/lib/auth/guards";
import * as hiringTeam from "@resumerank/core/services/hiring-team";
import * as departments from "@resumerank/core/services/departments";

export type { HiringTeam, HiringTeamMember } from "@resumerank/core/services/hiring-team";
export type {
  DepartmentItem,
  DepartmentMemberItem,
  DepartmentOption,
} from "@resumerank/core/services/departments";

export async function getHiringTeam(jobId: string): Promise<hiringTeam.HiringTeam | null> {
  const user = await requireMember();
  return hiringTeam.getHiringTeam(tenantContext(user), jobId);
}

export async function listDepartmentOptions(): Promise<departments.DepartmentOption[]> {
  const user = await requireMember();
  return departments.listDepartmentOptions(tenantContext(user));
}

export async function listDepartments(): Promise<departments.DepartmentItem[]> {
  const user = await requireMember();
  return departments.listDepartments(tenantContext(user));
}
