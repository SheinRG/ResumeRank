import { cacheLife, cacheTag } from "next/cache";

import { requireMember, tenantContext } from "@/lib/auth/guards";
import { dashboardTag } from "@/server/cache-tags";
import * as dashboard from "@resumerank/core/services/dashboard";
import type { TenantContext } from "@resumerank/core/services/context";

export type {
  ActivityFeedItem,
  DashboardData,
  DashboardStats,
  FunnelStagePoint,
  ScoreBucket,
  WeekPoint,
} from "@resumerank/core/services/dashboard";

/**
 * Mutations expire the tag, but only on the instance that handled them (the
 * default cache is in-memory), so the lifetime also bounds how stale another
 * instance's copy can get.
 */
const DASHBOARD_CACHE = { stale: 30, revalidate: 30, expire: 60 };

// The guard runs outside the cache: the context argument is part of the key,
// so an entry is only ever served back to the user and tenant that built it.
async function cachedDashboardData(ctx: TenantContext): Promise<dashboard.DashboardData> {
  "use cache";
  cacheLife(DASHBOARD_CACHE);
  cacheTag(dashboardTag(ctx.companyId));
  return dashboard.getDashboardData(ctx);
}

export async function getDashboardData(): Promise<dashboard.DashboardData> {
  const user = await requireMember();
  return cachedDashboardData(tenantContext(user));
}
