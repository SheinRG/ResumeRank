import { requireStaff } from "@/lib/auth/guards";
import { listStaffAudit, type StaffAuditPage } from "@resumerank/core/staff/audit";
import {
  companyOverview,
  searchCompanies,
  type CompanyOverview,
  type CompanySearchResult,
} from "@resumerank/core/staff/companies";
import type { StaffAuditPageInput } from "@resumerank/core/validators/staff";

export type { CompanyOverview, CompanySearchResult, StaffAuditPage };

export async function findCompanies(q: string): Promise<CompanySearchResult[]> {
  return searchCompanies(await requireStaff(), q);
}

export async function getCompanyOverview(companyId: string): Promise<CompanyOverview> {
  return companyOverview(await requireStaff(), companyId);
}

export async function getStaffAudit(input: StaffAuditPageInput): Promise<StaffAuditPage> {
  return listStaffAudit(await requireStaff(), input);
}
