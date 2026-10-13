// Type-only: the enums module carries Zod, and this file ships in the sidebar's bundle.
import type { Role } from "@resumerank/core/validators/enums";

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MEMBER: "Recruiter",
  HIRING_MANAGER: "Hiring manager",
  INTERVIEWER: "Interviewer",
  VIEWER: "Viewer",
};

/** One line per role for pickers, so whoever assigns one knows what it opens up. */
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  OWNER: "Everything, including the workspace's security policies.",
  ADMIN: "Everything except owner-only policies; manages the team.",
  MEMBER: "Runs hiring across every job: candidates, pipeline, AI scoring.",
  HIRING_MANAGER: "Their jobs only: edits them, moves stages, sees scores, rates.",
  INTERVIEWER: "Their jobs only: reads resumes and submits their own rating.",
  VIEWER: "Read-only access to every job and candidate.",
};

export const INVITABLE_ROLES = ["ADMIN", "MEMBER", "HIRING_MANAGER", "INTERVIEWER", "VIEWER"] as const satisfies readonly Role[];

/** Every role, most powerful first. */
export const ALL_ROLES: readonly Role[] = ["OWNER", ...INVITABLE_ROLES];
