import { cache } from "react";

import { auth } from "@/lib/auth";
import { db } from "@resumerank/core/db";
import { canAdmin, canWrite } from "@resumerank/core/auth/roles";
import { annotateLogContext } from "@resumerank/core/observability/log";
import { requiresSso } from "@resumerank/core/sso/policy";
import type { Role } from "@resumerank/core/validators/enums";
import type { TenantContext } from "@resumerank/core/services/context";

// Re-exported so UI affordances can keep importing capability checks from the
// guard module; the pure predicates live in the backend package where they are
// unit-tested.
export { canAdmin, canWrite };

/** Raised by guards; the action runner converts it into a typed ActionResult. */
export class GateError extends Error {}

/** A live session that didn't come through SSO, in a company that now requires it. */
export class SsoRequiredError extends GateError {
  constructor() {
    super("Your company requires single sign-on. Log in with SSO to continue.");
  }
}

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  emailVerified: Date | null;
  image: string | null;
  companyId: string | null;
  companyName: string | null;
  companyLogoUrl: string | null;
}

/** A signed-in user who has completed onboarding and belongs to a company. */
export interface CompanyUser extends CurrentUser {
  companyId: string;
}

/**
 * Resolves the signed-in user fresh from the database once per request, so a
 * role demotion takes effect on the next request — the JWT is never the
 * authorization source of truth. A token whose session version is behind the
 * user's has been revoked and is rejected the same way, as is a password or
 * Google session once the user's company requires single sign-on.
 *
 * Memoized per render with React `cache()`: the layout, the page and every
 * query it calls share one session read and one user lookup. Server actions
 * and route handlers run outside a render, so there it simply runs each call.
 */
export const requireUser = cache(async (): Promise<CurrentUser> => {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) throw new GateError("You need to sign in to do that.");
  annotateLogContext({ userId: id });

  const user = await db.user.findUnique({
    where: { id },
    select: {
      sessionVersion: true,
      id: true,
      name: true,
      email: true,
      role: true,
      emailVerified: true,
      image: true,
      companyId: true,
      company: { select: { name: true, logoUrl: true, ssoEnforced: true } },
    },
  });
  if (!user) throw new GateError("Your account no longer exists.");
  const { company, sessionVersion, ...rest } = user;
  annotateLogContext({ companyId: user.companyId });
  if (sessionVersion !== session.user.sessionVersion) {
    throw new GateError("Your session has ended. Log in again to continue.");
  }
  if (
    !session.user.viaSso &&
    requiresSso({ role: user.role, ssoEnforced: company?.ssoEnforced ?? false })
  ) {
    throw new SsoRequiredError();
  }
  return {
    ...rest,
    companyName: company?.name ?? null,
    companyLogoUrl: company?.logoUrl ?? null,
  };
});

/** Narrows to a user who has a company — onboarding must run before this passes. */
export async function requireMember(): Promise<CompanyUser> {
  const user = await requireUser();
  if (!user.companyId) {
    throw new GateError("Create or join a company first.");
  }
  return { ...user, companyId: user.companyId };
}

export async function requireWriter(): Promise<CompanyUser> {
  const user = await requireMember();
  if (!user.emailVerified) {
    throw new GateError("Verify your email to make changes.");
  }
  if (!canWrite(user.role)) {
    throw new GateError("Viewers have read-only access.");
  }
  return user;
}

export async function requireAdmin(): Promise<CompanyUser> {
  const user = await requireWriter();
  if (!canAdmin(user.role)) {
    throw new GateError("Only admins can do that.");
  }
  return user;
}

/** The service-layer view of a guarded user: only what tenancy and authorization need. */
export function tenantContext(user: CompanyUser): TenantContext {
  return { companyId: user.companyId, actorId: user.id, role: user.role };
}
