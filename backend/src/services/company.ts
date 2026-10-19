import { tenantDb, tenantTransaction } from "../tenant-db";
import { logActivity } from "../activity";
import { getAiBudget, type AiBudget } from "../ai-budget";
import type { Prisma } from "../generated/prisma/client";
import type { UpdateCompanyInput } from "../validators/company";
import type { WorkspaceFormatInput } from "../validators/locale";
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
  /** Defaults for members who haven't chosen their own format. */
  locale: string;
  timeZone: string;
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
  locale: true,
  timeZone: true,
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

  return tenantTransaction(ctx, async (tx) => {
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

export interface WorkspaceFormat {
  locale: string;
  timeZone: string;
}

/** Members who haven't chosen their own see dates and numbers this way. */
export async function updateWorkspaceFormat(
  ctx: TenantContext,
  input: WorkspaceFormatInput,
): Promise<WorkspaceFormat> {
  assertCanAdmin(ctx);
  return tenantTransaction(ctx, async (tx) => {
    const company = await tx.company.update({
      where: { id: ctx.companyId },
      data: { locale: input.locale, timeZone: input.timeZone },
      select: { locale: true, timeZone: true },
    });
    await logActivity(
      {
        companyId: ctx.companyId,
        actorId: ctx.actorId,
        action: "company.format",
        entityType: "company",
        entityId: ctx.companyId,
        summary: `set the workspace's default format to ${company.locale}, ${company.timeZone}`,
        metadata: { locale: company.locale, timeZone: company.timeZone },
      },
      tx,
    );
    return company;
  });
}
