import { requireAdmin, tenantContext } from "@/lib/auth/guards";
import * as billing from "@resumerank/core/services/billing";

export type { BillingOverview, PaymentAlert, PlanOption } from "@resumerank/core/services/billing";

export async function getBillingOverview(): Promise<billing.BillingOverview> {
  const user = await requireAdmin();
  return billing.getBillingOverview(tenantContext(user));
}

export async function getPaymentAlert(): Promise<billing.PaymentAlert | null> {
  const user = await requireAdmin();
  return billing.getPaymentAlert(tenantContext(user));
}
