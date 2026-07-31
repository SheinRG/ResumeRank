import type { Role } from "../validators/enums";

/**
 * Role → capability mapping. Framework-agnostic and pure so it can be unit
 * tested and reused: OWNER/ADMIN/MEMBER may write, only OWNER/ADMIN administer,
 * VIEWER is strictly read-only. The Next guards still re-check the live role
 * from the database on every request — this is the predicate they call, never
 * the authorization source of truth on its own.
 */
export const WRITE_ROLES: readonly Role[] = ["OWNER", "ADMIN", "MEMBER"];
export const ADMIN_ROLES: readonly Role[] = ["OWNER", "ADMIN"];

export function canWrite(role: Role): boolean {
  return WRITE_ROLES.includes(role);
}

export function canAdmin(role: Role): boolean {
  return ADMIN_ROLES.includes(role);
}
