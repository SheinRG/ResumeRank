import { db } from "@resumerank/core/db";
import { requireUser } from "@/lib/auth/guards";
import { PAGE_SIZE } from "@resumerank/core/validators/search";
import type { Prisma } from "@resumerank/core/generated/prisma/client";
import type { Paged } from "@resumerank/core/types/paged";
import { resolvePageWindow } from "./pagination";

export type ActivityEntityType = "job" | "candidate" | "application" | "user";

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
  actor: { id: string; name: string; image: string | null };
}

export async function listActivity(
  params: ActivityListParams,
): Promise<Paged<ActivityItem>> {
  await requireUser();

  const where: Prisma.ActivityLogWhereInput = { entityType: params.entityType };
  const total = await db.activityLog.count({ where });
  const { pageCount, skip, take, effectivePage, overflow } = resolvePageWindow(
    params.page,
    total,
  );

  if (overflow) {
    return { items: [], total, page: effectivePage, pageSize: PAGE_SIZE, pageCount };
  }

  const items = await db.activityLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    skip,
    take,
    include: { actor: { select: { id: true, name: true, image: true } } },
  });

  return { items, total, page: effectivePage, pageSize: PAGE_SIZE, pageCount };
}
