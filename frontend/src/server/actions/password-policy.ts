"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin, tenantContext } from "@/lib/auth/guards";
import type { PasswordPolicy } from "@resumerank/core/auth/password-policy";
import { setPasswordPolicy } from "@resumerank/core/services/password-policy";
import { actionError, actionOk, type ActionResult } from "@resumerank/core/types/action";
import { passwordPolicySchema } from "@resumerank/core/validators/password-policy";
import { expireTenantReads } from "@/server/cache-tags";
import { runAction } from "@/server/run-action";

export async function setPasswordPolicyAction(input: unknown): Promise<ActionResult<PasswordPolicy>> {
  return runAction("setPasswordPolicy", async () => {
    const parsed = passwordPolicySchema.safeParse(input);
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const admin = await requireAdmin();
    const policy = await setPasswordPolicy(tenantContext(admin), parsed.data);
    revalidatePath("/settings/security");
    expireTenantReads(admin.companyId);
    return actionOk(policy);
  });
}
