import { db } from "../db";
import { NotFoundError } from "../services/errors";
import { logStaffAction, type StaffAuditor, type StaffRole } from "./actor";

/**
 * Who is staff. Granted and revoked only with `npm run staff`, by someone
 * with the database credentials: no request path can make anyone staff.
 */

export interface StaffListing {
  userId: string;
  name: string;
  email: string;
  role: StaffRole;
  hasSecondFactor: boolean;
  createdAt: Date;
}

export async function listStaff(): Promise<StaffListing[]> {
  const rows = await db.staffMember.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      userId: true,
      role: true,
      createdAt: true,
      user: { select: { name: true, email: true, mfaEnabledAt: true } },
    },
  });
  return rows.map(({ user, ...row }) => ({
    ...row,
    name: user.name,
    email: user.email,
    hasSecondFactor: user.mfaEnabledAt !== null,
  }));
}

async function accountByEmail(email: string): Promise<{ id: string; name: string; email: string; mfaEnabledAt: Date | null }> {
  const user = await db.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, name: true, email: true, mfaEnabledAt: true },
  });
  if (!user) throw new NotFoundError(`No account uses ${email}. They need to sign up first.`);
  return user;
}

export interface StaffGrant {
  email: string;
  role: StaffRole;
  previous: StaffRole | null;
  /** The console refuses staff without a second factor; the grant still stands. */
  hasSecondFactor: boolean;
}

export async function grantStaff(by: StaffAuditor, email: string, role: StaffRole): Promise<StaffGrant> {
  const user = await accountByEmail(email);
  return db.$transaction(async (tx) => {
    const existing = await tx.staffMember.findUnique({ where: { userId: user.id }, select: { role: true } });
    await tx.staffMember.upsert({ where: { userId: user.id }, create: { userId: user.id, role }, update: { role } });
    await logStaffAction(
      by,
      {
        action: "staff.grant",
        summary: `made ${user.email} ${role === "ADMIN" ? "a staff admin" : "support staff"}`,
        targetUserId: user.id,
        metadata: { role, previous: existing?.role ?? null },
      },
      tx,
    );
    return { email: user.email, role, previous: existing?.role ?? null, hasSecondFactor: user.mfaEnabledAt !== null };
  });
}

export async function revokeStaff(by: StaffAuditor, email: string): Promise<{ email: string; revoked: boolean }> {
  const user = await accountByEmail(email);
  return db.$transaction(async (tx) => {
    const { count } = await tx.staffMember.deleteMany({ where: { userId: user.id } });
    if (count === 0) return { email: user.email, revoked: false };
    // Support sessions ride on the staff member's sign-in; losing staff
    // ends them at once rather than at their expiry.
    await tx.supportSession.updateMany({
      where: { staffUserId: user.id, endedAt: null },
      data: { endedAt: new Date() },
    });
    await logStaffAction(
      by,
      { action: "staff.revoke", summary: `removed ${user.email} from staff`, targetUserId: user.id },
      tx,
    );
    return { email: user.email, revoked: true };
  });
}
