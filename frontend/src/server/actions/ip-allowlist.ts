"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin, requireRecentAuth, tenantContext } from "@/lib/auth/guards";
import { addIpRange, removeIpRange, type IpRange } from "@resumerank/core/services/ip-allowlist";
import { actionError, actionOk, type ActionResult } from "@resumerank/core/types/action";
import { addIpRangeSchema, ipRangeIdSchema } from "@resumerank/core/validators/ip-allowlist";
import { expireTenantReads } from "@/server/cache-tags";
import { runAction } from "@/server/run-action";

const SECURITY_PATH = "/settings/security";

export async function addIpRangeAction(input: unknown): Promise<ActionResult<IpRange>> {
  return runAction("addIpRange", async () => {
    const parsed = addIpRangeSchema.safeParse(input);
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const admin = await requireAdmin();
    await requireRecentAuth();
    const range = await addIpRange(tenantContext(admin), parsed.data);
    revalidatePath(SECURITY_PATH);
    expireTenantReads(admin.companyId);
    return actionOk(range);
  });
}

export async function removeIpRangeAction(input: unknown): Promise<ActionResult<IpRange>> {
  return runAction("removeIpRange", async () => {
    const parsed = ipRangeIdSchema.safeParse(input);
    if (!parsed.success) return actionError("That range is no longer on the list.");
    const admin = await requireAdmin();
    await requireRecentAuth();
    const range = await removeIpRange(tenantContext(admin), parsed.data);
    revalidatePath(SECURITY_PATH);
    expireTenantReads(admin.companyId);
    return actionOk(range);
  });
}
