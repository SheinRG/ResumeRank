import { headers } from "next/headers";

import { canAdmin, requireUser, tenantContext } from "@/lib/auth/guards";
import { isBillingEnabled } from "@resumerank/core/env";
import { clientIp, UNKNOWN_IP } from "@resumerank/core/request-ip";
import { hasFeature } from "@resumerank/core/services/features";
import * as allowlist from "@resumerank/core/services/ip-allowlist";

export type { IpRange } from "@resumerank/core/services/ip-allowlist";

export interface IpAllowlistPanel {
  ranges: allowlist.IpRange[];
  /** This request's address, so an owner can see whether the list covers it; null when it can't be established. */
  clientIp: string | null;
  canChange: boolean;
  entitled: boolean;
  /** Whether a plan can unlock it (billing on), rather than staff. */
  upgradable: boolean;
}

/** Null for members, who can't see the list, and for users without a workspace. */
export async function getIpAllowlist(): Promise<IpAllowlistPanel | null> {
  const user = await requireUser();
  if (!user.companyId || !canAdmin(user.role)) return null;
  const ctx = tenantContext({ ...user, companyId: user.companyId });
  const [ranges, entitled, requestHeaders] = await Promise.all([
    allowlist.listIpRanges(ctx),
    hasFeature(ctx, "ip-allowlist"),
    headers(),
  ]);
  const ip = clientIp(requestHeaders);
  return {
    ranges,
    clientIp: ip === UNKNOWN_IP ? null : ip,
    canChange: user.role === "OWNER",
    entitled,
    upgradable: isBillingEnabled(),
  };
}
