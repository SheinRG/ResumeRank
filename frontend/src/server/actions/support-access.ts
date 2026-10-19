"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin, requireRecentAuth, tenantContext } from "@/lib/auth/guards";
import { setSupportAccess, type SupportAccess } from "@resumerank/core/services/support-access";
import { actionError, actionOk, type ActionResult } from "@resumerank/core/types/action";
import { supportAccessSchema } from "@resumerank/core/validators/support-access";
import { expireTenantReads } from "@/server/cache-tags";
import { runAction } from "@/server/run-action";

export async function setSupportAccessAction(input: unknown): Promise<ActionResult<SupportAccess>> {
  return runAction("setSupportAccess", async () => {
    const parsed = supportAccessSchema.safeParse(input);
    if (!parsed.success) {
      return actionError("Choose how long support may have access.", parsed.error.flatten().fieldErrors);
    }
    const admin = await requireAdmin();
    await requireRecentAuth();
    const access = await setSupportAccess(tenantContext(admin), parsed.data);
    revalidatePath("/settings/security");
    expireTenantReads(admin.companyId);
    return actionOk(access);
  });
}
