import { requireMember, tenantContext } from "@/lib/auth/guards";
import * as dashboard from "@resumerank/core/services/dashboard";

export type {
  ActivityFeedItem,
  DashboardData,
  DashboardStats,
  FunnelStagePoint,
  ScoreBucket,
  WeekPoint,
} from "@resumerank/core/services/dashboard";

export async function getDashboardData(): Promise<dashboard.DashboardData> {
  const user = await requireMember();
  return dashboard.getDashboardData(tenantContext(user));
}
