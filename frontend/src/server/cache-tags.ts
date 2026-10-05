import { revalidateTag, updateTag } from "next/cache";

/** The tenant's cached dashboard aggregates (see queries/dashboard.ts). */
export function dashboardTag(companyId: string): string {
  return `company:${companyId}:dashboard`;
}

/**
 * Every mutation writes to the activity log, and the dashboard shows the
 * recent log alongside counts it may have changed, so each one expires the
 * tenant's dashboard; the next read waits for fresh data. Server actions only
 * (`updateTag` throws elsewhere — background work uses `revalidateTag`).
 */
export function expireTenantReads(companyId: string | null): void {
  if (companyId) updateTag(dashboardTag(companyId));
}

/**
 * The scoring worker's counterpart: finished runs move scores the dashboard
 * aggregates. It runs after the response (or from cron), outside any server
 * action, so it expires through `revalidateTag` instead.
 */
export function expireScoredTenants(companyIds: string[]): void {
  for (const companyId of companyIds) {
    revalidateTag(dashboardTag(companyId), { expire: 0 });
  }
}
