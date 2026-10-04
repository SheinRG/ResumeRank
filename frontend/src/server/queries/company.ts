import { notFound } from "next/navigation";

import { requireMember, tenantContext } from "@/lib/auth/guards";
import type { AiBudget } from "@resumerank/core/ai-budget";
import * as company from "@resumerank/core/services/company";

export type { CompanyDetail } from "@resumerank/core/services/company";
export type { AiBudget } from "@resumerank/core/ai-budget";

export async function getAiUsage(): Promise<AiBudget> {
  const user = await requireMember();
  return company.getAiUsage(tenantContext(user));
}

export async function getCompany(): Promise<company.CompanyDetail> {
  const user = await requireMember();
  const detail = await company.getCompany(tenantContext(user));
  if (!detail) {
    notFound();
  }
  return detail;
}
