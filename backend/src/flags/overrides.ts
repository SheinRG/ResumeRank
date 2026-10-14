import { db } from "../db";
import { logActivity } from "../activity";
import { NotFoundError } from "../services/errors";
import type { FlagOverrideInput } from "../validators/feature-flag";
import { FEATURE_FLAGS, flagDefinition, type FeatureFlag } from "./registry";
import { decideAll, decideFlag, type FlagDecision } from "./resolve";

/**
 * Staff tooling, not a tenant service: the person running it isn't a member
 * of the company, so there is no tenant context and it connects as the table
 * owner, like seeds and migrations. Every change still lands in the
 * company's own audit log, where its admins can see it.
 */

interface CompanyRef {
  id: string;
  name: string;
  slug: string;
}

async function findCompany(slug: string): Promise<CompanyRef> {
  const company = await db.company.findUnique({ where: { slug }, select: { id: true, name: true, slug: true } });
  if (!company) throw new NotFoundError(`No company has the slug "${slug}".`);
  return company;
}

export interface FlagOverrideChange {
  company: CompanyRef;
  flag: FeatureFlag;
  previous: boolean | null;
  override: boolean | null;
  changed: boolean;
  decision: FlagDecision;
}

function summaryOf(flag: FeatureFlag, enabled: boolean | null): string {
  const { label } = flagDefinition(flag);
  if (enabled === null) return `returned ${label} to its default for this workspace`;
  return `${enabled ? "turned on" : "turned off"} ${label} for this workspace`;
}

export async function setFlagOverride(input: FlagOverrideInput): Promise<FlagOverrideChange> {
  const company = await findCompany(input.companySlug);
  const where = { companyId_flag: { companyId: company.id, flag: input.flag } };

  return db.$transaction(async (tx) => {
    const existing = await tx.featureFlagOverride.findUnique({ where, select: { enabled: true } });
    const previous = existing?.enabled ?? null;
    const result = (changed: boolean): FlagOverrideChange => ({
      company,
      flag: input.flag,
      previous,
      override: input.enabled,
      changed,
      decision: decideFlag(input.flag, company.id, input.enabled ?? undefined),
    });
    if (previous === input.enabled) return result(false);

    if (input.enabled === null) {
      await tx.featureFlagOverride.delete({ where });
    } else {
      await tx.featureFlagOverride.upsert({
        where,
        create: { companyId: company.id, flag: input.flag, enabled: input.enabled, reason: input.reason },
        update: { enabled: input.enabled, reason: input.reason ?? null },
      });
    }
    await logActivity(
      {
        companyId: company.id,
        actorId: null,
        action: "feature.override",
        entityType: "company",
        entityId: company.id,
        summary: summaryOf(input.flag, input.enabled),
        metadata: { flag: input.flag, enabled: input.enabled, previous, reason: input.reason ?? null },
      },
      tx,
    );
    return result(true);
  });
}

export interface CompanyFlagReport {
  company: CompanyRef;
  flags: Array<{ flag: FeatureFlag; decision: FlagDecision; reason: string | null }>;
}

export async function describeCompanyFlags(slug: string): Promise<CompanyFlagReport> {
  const company = await findCompany(slug);
  const rows = await db.featureFlagOverride.findMany({
    where: { companyId: company.id },
    select: { flag: true, enabled: true, reason: true },
  });
  const decisions = decideAll(company.id, rows);
  const reasons = new Map(rows.map((row) => [row.flag, row.reason]));
  return {
    company,
    flags: FEATURE_FLAGS.map((flag) => ({ flag, decision: decisions[flag], reason: reasons.get(flag) ?? null })),
  };
}
