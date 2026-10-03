import { notFound } from "next/navigation";

import { requireMember, tenantContext } from "@/lib/auth/guards";
import * as company from "@resumerank/core/services/company";

export type { CompanyDetail } from "@resumerank/core/services/company";

export async function getCompany(): Promise<company.CompanyDetail> {
  const user = await requireMember();
  const detail = await company.getCompany(tenantContext(user));
  if (!detail) {
    notFound();
  }
  return detail;
}
