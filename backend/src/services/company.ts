import { tenantDb } from "../tenant-db";
import { logActivity } from "../activity";
import { getAiBudget, type AiBudget } from "../ai-budget";
import type { Prisma } from "../generated/prisma/client";
import type { UpdateCompanyInput } from "../validators/company";
import { assertCanAdmin, type TenantContext } from "./context";

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

const COMPANY_DETAIL_SELECT = {
  id: true,
  name: true,
  slug: true,
  logoUrl: true,
  website: true,
  description: true,
  industry: true,
  size: true,
  location: true,
} satisfies Prisma.CompanySelect;

/** Tokens spent on AI over the rolling 30-day budget window, for the settings page. */
export async function getAiUsage(ctx: TenantContext): Promise<AiBudget> {
  return getAiBudget(ctx.companyId);
}

export async function getCompany(ctx: TenantContext): Promise<CompanyDetail | null> {
  return tenantDb(ctx).company.findUnique({
    where: { id: ctx.companyId },
    select: COMPANY_DETAIL_SELECT,
  });
}

export async function updateCompany(
  ctx: TenantContext,
  input: UpdateCompanyInput,
): Promise<CompanyDetail> {
  assertCanAdmin(ctx);
  const { name, logoUrl, website, description, industry, size, location } = input;

  return tenantDb(ctx).$transaction(async (tx) => {
    const company = await tx.company.update({
      where: { id: ctx.companyId },
      data: {
        name,
        logoUrl: logoUrl === "" ? null : logoUrl,
        website: website === "" ? null : website,
        description: description ?? null,
        industry: industry ?? null,
        size: size ?? null,
        location: location ?? null,
      },
      select: COMPANY_DETAIL_SELECT,
    });
    await logActivity(
      {
        companyId: ctx.companyId,
        actorId: ctx.actorId,
        action: "company.update",
        entityType: "user",
        entityId: ctx.actorId,
        summary: `updated ${company.name}'s company profile`,
      },
      tx,
    );
    return company;
  });
}
