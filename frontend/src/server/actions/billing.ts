"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, tenantContext } from "@/lib/auth/guards";
import { openBillingPortal, startCheckout } from "@resumerank/core/services/billing";
import { checkoutSchema } from "@resumerank/core/validators/billing";
import { expireTenantReads } from "@/server/cache-tags";
import { runAction } from "@/server/run-action";
import { actionError, actionOk, type ActionResult } from "@resumerank/core/types/action";

const BILLING_PATH = "/settings/billing";

/** Returns Stripe's checkout URL; the plan itself changes only when Stripe's webhook confirms payment. */
export async function startCheckoutAction(input: unknown): Promise<ActionResult<{ url: string }>> {
  return runAction("startCheckout", async () => {
    const parsed = checkoutSchema.safeParse(input);
    if (!parsed.success) return actionError("Choose a plan.");
    const user = await requireAdmin();
    const result = await startCheckout(tenantContext(user), parsed.data);
    revalidatePath(BILLING_PATH);
    expireTenantReads(user.companyId);
    return actionOk(result);
  });
}

export async function openBillingPortalAction(): Promise<ActionResult<{ url: string }>> {
  return runAction("openBillingPortal", async () => {
    const user = await requireAdmin();
    return actionOk(await openBillingPortal(tenantContext(user)));
  });
}
