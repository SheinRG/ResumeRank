import { db } from "../db";
import { logActivity } from "../activity";
import type { Prisma } from "../generated/prisma/client";
import { DomainError, ForbiddenError } from "../services/errors";
import type { SupportSessionStartInput } from "../validators/staff";
import { assertStaffRole, auditorOf, logStaffAction, type StaffActor, type StaffAuditor } from "./actor";
import { staffCompanyMember } from "./companies";

/**
 * A support session lets a staff member see a workspace as one of its
 * members, to reproduce what they report. Three things bound it: the
 * workspace's owners must have granted support access (`Company.supportAccessUntil`),
 * it lasts at most an hour, and it is read-only. The guards check all of it
 * on every request (`activeSupportSession`) and make every tenant
 * transaction read-only (`TenantContext.readOnly`); the workspace's audit
 * log records each start and end, with the reason given.
 */

const SESSION_SELECT = {
  id: true,
  companyId: true,
  staffUserId: true,
  staffName: true,
  targetUserId: true,
  targetName: true,
  reason: true,
  startedAt: true,
  expiresAt: true,
} satisfies Prisma.SupportSessionSelect;

export type ActiveSupportSession = Prisma.SupportSessionGetPayload<{ select: typeof SESSION_SELECT }>;

/**
 * The support session this sign-in is in, if it's still live: not ended or
 * expired, the workspace still grants access, and the staff member is still
 * staff. Anything else and the sign-in is simply the staff member again.
 */
export async function activeSupportSession(
  loginId: string,
  staffUserId: string,
  now = new Date(),
): Promise<ActiveSupportSession | null> {
  const session = await db.supportSession.findFirst({
    where: {
      loginId,
      staffUserId,
      endedAt: null,
      expiresAt: { gt: now },
      company: { supportAccessUntil: { gt: now } },
    },
    orderBy: { startedAt: "desc" },
    select: SESSION_SELECT,
  });
  if (!session) return null;
  const staff = await db.staffMember.findUnique({ where: { userId: staffUserId }, select: { role: true } });
  return staff ? session : null;
}

type Tx = Prisma.TransactionClient;

async function endSessions(tx: Tx, by: StaffAuditor, where: Prisma.SupportSessionWhereInput, now: Date): Promise<string[]> {
  const ended = await tx.supportSession.updateManyAndReturn({
    where: { ...where, endedAt: null },
    data: { endedAt: now },
    select: { id: true, companyId: true, targetUserId: true, targetName: true, staffName: true, expiresAt: true },
  });
  for (const session of ended) {
    const expired = session.expiresAt <= now;
    await logActivity(
      {
        companyId: session.companyId,
        actorId: null,
        action: "support.session_end",
        entityType: "user",
        entityId: session.targetUserId,
        summary: `ended ${session.staffName}'s support session as ${session.targetName}`,
        metadata: { supportSessionId: session.id, expired },
      },
      tx,
    );
    await logStaffAction(
      by,
      {
        action: "staff.support_session_end",
        summary: `stopped viewing as ${session.targetName}`,
        companyId: session.companyId,
        targetUserId: session.targetUserId,
        metadata: { supportSessionId: session.id, expired },
      },
      tx,
    );
  }
  return ended.map((session) => session.companyId);
}

export interface StartedSupportSession {
  id: string;
  companyId: string;
  expiresAt: Date;
}

/**
 * Starts viewing a workspace as one of its members, on the staff member's
 * own sign-in. Any session that sign-in already had ends first. It can't
 * outlast the workspace's grant.
 */
export async function startSupportSession(
  actor: StaffActor,
  loginId: string,
  input: SupportSessionStartInput,
  now = new Date(),
): Promise<StartedSupportSession> {
  assertStaffRole(actor, "SUPPORT");
  const { company, user } = await staffCompanyMember(input.companyId, input.userId);
  if (user.id === actor.userId) throw new DomainError("You can't start a support session as yourself.");

  return db.$transaction(async (tx) => {
    const grant = await tx.company.findUniqueOrThrow({
      where: { id: company.id },
      select: { supportAccessUntil: true },
    });
    if (!grant.supportAccessUntil || grant.supportAccessUntil <= now) {
      throw new ForbiddenError(
        `${company.name} hasn't given ResumeRank support access. An owner can grant it in Settings → Security.`,
      );
    }
    await endSessions(tx, auditorOf(actor), { loginId, staffUserId: actor.userId }, now);

    const expiresAt = new Date(Math.min(now.getTime() + input.minutes * 60_000, grant.supportAccessUntil.getTime()));
    const session = await tx.supportSession.create({
      data: {
        companyId: company.id,
        staffUserId: actor.userId,
        staffName: actor.name,
        targetUserId: user.id,
        targetName: user.name,
        loginId,
        reason: input.reason,
        startedAt: now,
        expiresAt,
      },
      select: { id: true, companyId: true, expiresAt: true },
    });
    await logActivity(
      {
        companyId: company.id,
        actorId: null,
        action: "support.session_start",
        entityType: "user",
        entityId: user.id,
        summary: `started a read-only support session as ${user.name}, for ${actor.name}: ${input.reason}`,
        metadata: { supportSessionId: session.id, minutes: input.minutes, expiresAt: expiresAt.toISOString() },
      },
      tx,
    );
    await logStaffAction(
      auditorOf(actor),
      {
        action: "staff.support_session_start",
        summary: `started viewing ${company.name} as ${user.name}`,
        companyId: company.id,
        targetUserId: user.id,
        metadata: { supportSessionId: session.id, minutes: input.minutes, reason: input.reason },
      },
      tx,
    );
    return session;
  });
}

/** Ends the support session this sign-in is in; returns its workspace, or null if there was none. */
export async function endSupportSession(
  by: StaffAuditor & { userId: string },
  loginId: string,
  now = new Date(),
): Promise<string | null> {
  const [companyId] = await db.$transaction((tx) => endSessions(tx, by, { loginId, staffUserId: by.userId }, now));
  return companyId ?? null;
}
