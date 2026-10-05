import { tenantDb } from "../tenant-db";
import { PAGE_SIZE } from "../validators/search";
import type { Prisma } from "../generated/prisma/client";
import type { Paged } from "../types/paged";
import type { TenantContext } from "./context";
import { countCapped, createdAtSort, keysetPage, type PageParams } from "./pagination";

export type ActivityEntityType = "job" | "candidate" | "application" | "user";

export interface ActivityActor {
  id: string | null;
  name: string;
  image: string | null;
}

export const activityActorInclude = {
  actor: { select: { id: true, name: true, image: true } },
} as const;

const DELETED_ACTOR: ActivityActor = { id: null, name: "Deleted user", image: null };

/** Entries outlive their author's account; render those as an anonymous actor. */
export function toActivityActor(actor: ActivityActor | null): ActivityActor {
  return actor ?? DELETED_ACTOR;
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
  const where: Prisma.ActivityLogWhereInput = {
    companyId: ctx.companyId,
    entityType: params.entityType,
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
  const items = page.items.map((row) => ({ ...row, actor: toActivityActor(row.actor) }));

  return {
    items,
    total,
    totalCapped,
    pageSize: PAGE_SIZE,
    nextCursor: page.nextCursor,
    prevCursor: page.prevCursor,
  };
}
