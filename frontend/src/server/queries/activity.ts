import { requireMember, tenantContext } from "@/lib/auth/guards";
import * as activity from "@resumerank/core/services/activity";
import type { Paged } from "@resumerank/core/types/paged";

export type {
  ActivityActor,
  ActivityEntityType,
  ActivityItem,
  ActivityListParams,
} from "@resumerank/core/services/activity";

export async function listActivity(
  params: activity.ActivityListParams,
): Promise<Paged<activity.ActivityItem>> {
  const user = await requireMember();
  return activity.listActivity(tenantContext(user), params);
}
