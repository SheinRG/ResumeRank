import { canAdmin, canWrite } from "../auth/roles";
import type { Role } from "../validators/enums";
import { ForbiddenError } from "./errors";

/**
 * Who is acting and in which tenant. Each adapter builds it from its own
 * trusted source (a DB-rechecked session, an API key, a queue message), so
 * services never read a session and every query can be scoped to
 * `companyId` without trusting client input.
 */
export interface TenantContext {
  companyId: string;
  actorId: string;
  role: Role;
}

/** Re-checked here so a worker or API adapter can't skip the role gate the session guards apply. */
export function assertCanWrite(ctx: TenantContext): void {
  if (!canWrite(ctx.role)) {
    throw new ForbiddenError("Viewers have read-only access.");
  }
}

export function assertCanAdmin(ctx: TenantContext): void {
  if (!canAdmin(ctx.role)) {
    throw new ForbiddenError("Only admins can do that.");
  }
}
