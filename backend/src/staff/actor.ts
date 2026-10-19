import { db } from "../db";
import type { Prisma } from "../generated/prisma/client";
import type { StaffRole } from "../generated/prisma/enums";
import { ForbiddenError } from "../services/errors";

/**
 * The staff console is not a tenant service. The person using it isn't a
 * member of the companies they look after, so there is no tenant context:
 * staff code runs on the owner connection, says why it reads across tenants,
 * and records what it did twice, in the staff audit log and, for anything
 * that changes a workspace, in that workspace's own log under the ResumeRank
 * actor, where its admins can see it.
 */

export type { StaffRole };

/** Who is acting in the staff console, built by the staff guard from a DB-rechecked session. */
export interface StaffActor {
  userId: string;
  email: string;
  name: string;
  role: StaffRole;
  ipAddress: string | null;
}

/** Who wrote a staff audit entry: a staff member, or a command-line tool. */
export interface StaffAuditor {
  userId: string | null;
  email: string;
  ipAddress?: string | null;
}

const RANK: Record<StaffRole, number> = { SUPPORT: 0, ADMIN: 1 };

export function staffMay(role: StaffRole, needed: StaffRole): boolean {
  return RANK[role] >= RANK[needed];
}

/** Re-checked in the staff code so a caller can't skip what the guard checked. */
export function assertStaffRole(actor: StaffActor, needed: StaffRole): void {
  if (!staffMay(actor.role, needed)) {
    throw new ForbiddenError("Only staff admins can do that.");
  }
}

export interface StaffAuditInput {
  action: string;
  summary: string;
  companyId?: string | null;
  targetUserId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

interface StaffAuditWriter {
  staffAuditEntry: { create(args: { data: Prisma.StaffAuditEntryUncheckedCreateInput }): PromiseLike<unknown> };
}

/** Append-only, like the tenant audit log: pass the change's transaction so both commit together. */
export async function logStaffAction(
  by: StaffAuditor,
  entry: StaffAuditInput,
  client: StaffAuditWriter = db,
): Promise<void> {
  await client.staffAuditEntry.create({
    data: {
      staffUserId: by.userId,
      staffEmail: by.email,
      ipAddress: by.ipAddress ?? null,
      action: entry.action,
      summary: entry.summary,
      companyId: entry.companyId ?? null,
      targetUserId: entry.targetUserId ?? null,
      ...(entry.metadata === undefined ? {} : { metadata: entry.metadata }),
    },
  });
}

export function auditorOf(actor: StaffActor): StaffAuditor {
  return { userId: actor.userId, email: actor.email, ipAddress: actor.ipAddress };
}
