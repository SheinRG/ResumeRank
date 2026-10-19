import { tenantDb } from "../tenant-db";
import { AUTH_ACTION_PREFIX } from "../auth/audit";
import { referencedCandidateId, renderSummary } from "../audit/candidate-ref";
import { canAdmin } from "../auth/roles";
import { PAGE_SIZE } from "../validators/search";
import type { Prisma } from "../generated/prisma/client";
import type { Paged } from "../types/paged";
import { assertCan, type TenantContext } from "./context";
import { countCapped, createdAtSort, keysetPage, type PageParams } from "./pagination";

export type ActivityEntityType = "job" | "candidate" | "application" | "user" | "company" | "department";

export interface ActivityActor {
  id: string | null;
  name: string;
  image: string | null;
}

export const activityActorInclude = {
  actor: { select: { id: true, name: true, image: true } },
} as const;

const DELETED_ACTOR: ActivityActor = { id: null, name: "Deleted user", image: null };
const SYSTEM_ACTOR: ActivityActor = { id: null, name: "ResumeRank", image: null };

/** Work no member did: the app on its own schedule, ResumeRank staff, or Stripe. */
const SYSTEM_ACTIONS: ReadonlySet<string> = new Set([
  "audit.purge",
  "feature.override",
  "billing.subscription",
  "company.suspend",
  "company.unsuspend",
  "company.ai_budget",
  "support.session_start",
  "support.session_end",
  "support.sign_out",
]);

/** Entries outlive their author's account; render those as an anonymous actor. */
export function toActivityActor(actor: ActivityActor | null, action: string): ActivityActor {
  if (actor) return actor;
  return SYSTEM_ACTIONS.has(action) ? SYSTEM_ACTOR : DELETED_ACTOR;
}

interface SummaryRow {
  summary: string;
  entityType: string;
  entityId: string;
  metadata: Prisma.JsonValue | null;
}

/**
 * Puts candidates' current names back into summaries, which store only a
 * reference (audit/candidate-ref.ts); an erased candidate reads as deleted.
 */
export async function withCandidateNames<T extends SummaryRow>(ctx: TenantContext, rows: T[]): Promise<T[]> {
  const ids = [...new Set(rows.flatMap((row) => referencedCandidateId(row) ?? []))];
  const names =
    ids.length === 0
      ? new Map<string, string>()
      : new Map(
          (
            await tenantDb(ctx).candidate.findMany({
              where: { companyId: ctx.companyId, id: { in: ids } },
              select: { id: true, name: true },
            })
          ).map((candidate) => [candidate.id, candidate.name]),
        );
  return rows.map((row) => {
    const id = referencedCandidateId(row);
    return { ...row, summary: renderSummary(row.summary, id ? (names.get(id) ?? null) : null) };
  });
}

export interface ActivityListParams extends PageParams {
  entityType?: ActivityEntityType;
}

export interface ActivityItem {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
  actor: ActivityActor;
}

type ActivityRow = Prisma.ActivityLogGetPayload<{ include: typeof activityActorInclude }>;

export async function listActivity(
  ctx: TenantContext,
  params: ActivityListParams,
): Promise<Paged<ActivityItem>> {
  // The feed spans every job, so it isn't for roles scoped to some of them.
  assertCan(ctx, "activity.view");
  const where: Prisma.ActivityLogWhereInput = {
    companyId: ctx.companyId,
    entityType: params.entityType,
    // Sign-in events carry teammates' IP addresses and devices.
    ...(canAdmin(ctx.role) ? {} : { NOT: { action: { startsWith: AUTH_ACTION_PREFIX } } }),
  };
  const [{ total, totalCapped }, page] = await Promise.all([
    countCapped((take) => tenantDb(ctx).activityLog.count({ where, take })),
    keysetPage(createdAtSort<ActivityRow>("desc"), params, (query) =>
      tenantDb(ctx).activityLog.findMany({
        where: query.where ? { AND: [where, query.where] } : where,
        orderBy: query.orderBy,
        take: query.take,
        include: activityActorInclude,
      }),
    ),
  ]);
  const items = await withCandidateNames(
    ctx,
    page.items.map((row) => ({ ...row, actor: toActivityActor(row.actor, row.action) })),
  );

  return {
    items,
    total,
    totalCapped,
    pageSize: PAGE_SIZE,
    nextCursor: page.nextCursor,
    prevCursor: page.prevCursor,
  };
}
