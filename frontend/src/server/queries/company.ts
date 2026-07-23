import { notFound } from "next/navigation";

import { db } from "@resumerank/core/db";
import { requireMember } from "@/lib/auth/guards";

export interface CompanyDetail {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  website: string | null;
  description: string | null;
  industry: string | null;
  size: string | null;
  location: string | null;
}

export const COMPANY_DETAIL_SELECT = {
  id: true,
  name: true,
  slug: true,
  logoUrl: true,
  website: true,
  description: true,
  industry: true,
  size: true,
  location: true,
} as const;

export async function getCompany(): Promise<CompanyDetail> {
  const user = await requireMember();
  const company = await db.company.findUnique({
    where: { id: user.companyId },
    select: COMPANY_DETAIL_SELECT,
  });
  if (!company) {
    notFound();
  }
  return company;
}
