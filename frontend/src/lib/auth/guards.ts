import { auth } from "@/lib/auth";
import { db } from "@resumerank/core/db";
import { canAdmin, canWrite } from "@resumerank/core/auth/roles";
import type { Role } from "@resumerank/core/validators/enums";

// Re-exported so UI affordances can keep importing capability checks from the
// guard module; the pure predicates live in the backend package where they are
// unit-tested.
export { canAdmin, canWrite };

/** Raised by guards; the action runner converts it into a typed ActionResult. */
export class GateError extends Error {}

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  emailVerified: Date | null;
  image: string | null;
}

/**
 * Resolves the signed-in user fresh from the database on every call, so a
 * role demotion takes effect on the next request — the JWT is never the
 * authorization source of truth.
 */
export async function requireUser(): Promise<CurrentUser> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) throw new GateError("You need to sign in to do that.");

  const user = await db.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      emailVerified: true,
      image: true,
    },
  });
  if (!user) throw new GateError("Your account no longer exists.");
  return user;
}

export async function requireWriter(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!user.emailVerified) {
    throw new GateError("Verify your email to make changes.");
  }
  if (!canWrite(user.role)) {
    throw new GateError("Viewers have read-only access.");
  }
  return user;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireWriter();
  if (!canAdmin(user.role)) {
    throw new GateError("Only admins can do that.");
  }
  return user;
}
