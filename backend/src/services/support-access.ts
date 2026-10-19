import { logActivity } from "../activity";
import { tenantDb, tenantTransaction } from "../tenant-db";
import type { SupportAccessInput } from "../validators/support-access";
import { assertCanAdmin, type TenantContext } from "./context";
import { ForbiddenError, NotFoundError } from "./errors";

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_SESSIONS = 20;

export interface SupportSessionSummary {
  id: string;
  staffName: string;
  targetName: string;
  reason: string;
  startedAt: Date;
  expiresAt: Date;
  endedAt: Date | null;
}

export interface SupportAccess {
  /** Null, or a moment already past, means support can't open the workspace. */
  until: Date | null;
  sessions: SupportSessionSummary[];
}

const SESSION_SELECT = {
  id: true,
  staffName: true,
  targetName: true,
  reason: true,
  startedAt: true,
  expiresAt: true,
  endedAt: true,
} as const;

/** Whether support may open the workspace now, and every time it did lately. */
export async function getSupportAccess(ctx: TenantContext): Promise<SupportAccess> {
  assertCanAdmin(ctx);
  const client = tenantDb(ctx);
  const [company, sessions] = await Promise.all([
    client.company.findUnique({ where: { id: ctx.companyId }, select: { supportAccessUntil: true } }),
    client.supportSession.findMany({
      where: { companyId: ctx.companyId },
      orderBy: { startedAt: "desc" },
      take: RECENT_SESSIONS,
      select: SESSION_SELECT,
    }),
  ]);
  if (!company) throw new NotFoundError("Your company no longer exists.");
  return { until: company.supportAccessUntil, sessions };
}

/**
 * Lets ResumeRank support view the workspace as a member, read-only, for a
 * number of days; zero withdraws it, which also ends any session in progress.
 * Owners only: it opens the whole workspace to someone outside it.
 */
export async function setSupportAccess(ctx: TenantContext, input: SupportAccessInput, now = new Date()): Promise<SupportAccess> {
  assertCanAdmin(ctx);
  if (ctx.role !== "OWNER") {
    throw new ForbiddenError("Only an owner can change support access.");
  }
  const until = input.days === 0 ? null : new Date(now.getTime() + input.days * DAY_MS);

  return tenantTransaction(ctx, async (tx) => {
    const company = await tx.company.update({
      where: { id: ctx.companyId },
      data: { supportAccessUntil: until },
      select: { supportAccessUntil: true },
    });
    let ended = 0;
    if (until === null) {
      ({ count: ended } = await tx.supportSession.updateMany({
        where: { companyId: ctx.companyId, endedAt: null, expiresAt: { gt: now } },
        data: { endedAt: now },
      }));
    }
    await logActivity(
      {
        companyId: ctx.companyId,
        actorId: ctx.actorId,
        action: "company.support_access",
        entityType: "company",
        entityId: ctx.companyId,
        summary:
          until === null
            ? "withdrew ResumeRank support's access to the workspace"
            : `let ResumeRank support view the workspace for ${input.days} day${input.days === 1 ? "" : "s"}`,
        metadata: { days: input.days, until: until?.toISOString() ?? null, endedSessions: ended },
      },
      tx,
    );
    const sessions = await tx.supportSession.findMany({
      where: { companyId: ctx.companyId },
      orderBy: { startedAt: "desc" },
      take: RECENT_SESSIONS,
      select: SESSION_SELECT,
    });
    return { until: company.supportAccessUntil, sessions };
  });
}
