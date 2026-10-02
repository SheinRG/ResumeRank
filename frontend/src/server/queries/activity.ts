import { db } from "@resumerank/core/db";
import { requireMember } from "@/lib/auth/guards";
import { PAGE_SIZE } from "@resumerank/core/validators/search";
import type { Prisma } from "@resumerank/core/generated/prisma/client";
import type { Paged } from "@resumerank/core/types/paged";
import { resolvePageWindow } from "./pagination";

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

export interface ActivityListParams {
  entityType?: ActivityEntityType;
  page: number;
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

export async function listActivity(
  params: ActivityListParams,
): Promise<Paged<ActivityItem>> {
  const user = await requireMember();

  const where: Prisma.ActivityLogWhereInput = {
    companyId: user.companyId,
    entityType: params.entityType,
  };
  const total = await db.activityLog.count({ where });
  const { pageCount, skip, take, effectivePage, overflow } = resolvePageWindow(
    params.page,
    total,
  );

  if (overflow) {
    return { items: [], total, page: effectivePage, pageSize: PAGE_SIZE, pageCount };
  }

  const rows = await db.activityLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    skip,
    take,
    include: activityActorInclude,
  });
  const items = rows.map((row) => ({ ...row, actor: toActivityActor(row.actor) }));

  return { items, total, page: effectivePage, pageSize: PAGE_SIZE, pageCount };
}
