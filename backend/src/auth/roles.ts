import type { Role } from "../validators/enums";

/**
 * Role → capability mapping. Framework-agnostic and pure so it can be unit
 * tested and reused. The Next guards still re-check the live role from the
 * database on every request — this is the predicate they call, never the
 * authorization source of truth on its own.
 *
 * Every check names a permission rather than a role, so a later custom role
 * is a new row in this table, not a sweep through the call sites.
 */
export const PERMISSIONS = [
  /** Create jobs, archive and reopen them. */
  "job.manage",
  /** Edit a job's details and requirements. */
  "job.edit",
  /** Choose who works on a job: its hiring team and department. */
  "job.staff",
  /** Add, edit, delete and AI-extract candidates. */
  "candidate.manage",
  "candidate.export",
  /** Attach candidates to jobs, remove and restore applications. */
  "application.manage",
  "application.stage",
  "scoring.request",
  /** AI scores, verdicts and evidence. */
  "scoring.view",
  "scorecard.submit",
  /** Everyone's scorecards, not just your own. */
  "scorecard.viewAll",
  "activity.view",
  "department.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Which jobs a role reaches: all of the workspace's, or only those it's assigned to. */
export type AccessScope = "company" | "assigned";

const RECRUITER: readonly Permission[] = PERMISSIONS.filter((p) => p !== "department.manage");

const GRANTS: Record<Role, readonly Permission[]> = {
  OWNER: PERMISSIONS,
  ADMIN: PERMISSIONS,
  MEMBER: RECRUITER,
  HIRING_MANAGER: [
    "job.edit",
    "application.stage",
    "scoring.request",
    "scoring.view",
    "scorecard.submit",
    "scorecard.viewAll",
  ],
  // AI verdicts and colleagues' ratings stay hidden so they can't anchor the interview.
  INTERVIEWER: ["scorecard.submit"],
  VIEWER: ["scoring.view", "scorecard.viewAll", "activity.view"],
};

const SCOPES: Record<Role, AccessScope> = {
  OWNER: "company",
  ADMIN: "company",
  MEMBER: "company",
  HIRING_MANAGER: "assigned",
  INTERVIEWER: "assigned",
  VIEWER: "company",
};

export function can(role: Role, permission: Permission): boolean {
  return GRANTS[role].includes(permission);
}

export function accessScope(role: Role): AccessScope {
  return SCOPES[role];
}

export const ADMIN_ROLES: readonly Role[] = ["OWNER", "ADMIN"];

export function canAdmin(role: Role): boolean {
  return ADMIN_ROLES.includes(role);
}
