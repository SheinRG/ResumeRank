import { logActivity } from "../activity";
import { MAX_IP_RANGES } from "../auth/ip-allowlist";
import { tenantDb, tenantTransaction } from "../tenant-db";
import type { AddIpRangeInput, IpRangeIdInput } from "../validators/ip-allowlist";
import { assertCanAdmin, type TenantContext } from "./context";
import { ConflictError, ForbiddenError, NotFoundError } from "./errors";
import { assertFeature } from "./features";
import { isPrismaError } from "./prisma-errors";

export interface IpRange {
  id: string;
  cidr: string;
  label: string | null;
  createdAt: Date;
}

const RANGE_SELECT = { id: true, cidr: true, label: true, createdAt: true } as const;

function assertOwner(ctx: TenantContext): void {
  assertCanAdmin(ctx);
  if (ctx.role !== "OWNER") {
    throw new ForbiddenError("Only an owner can change which networks may use this workspace.");
  }
}

/** Admins see the list so they can tell people why they're blocked; only owners change it. */
export async function listIpRanges(ctx: TenantContext): Promise<IpRange[]> {
  assertCanAdmin(ctx);
  return tenantDb(ctx).ipAllowlistEntry.findMany({
    where: { companyId: ctx.companyId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: RANGE_SELECT,
  });
}

/**
 * The first range turns the allowlist on: from the next request, members
 * elsewhere are refused (owners excepted) and so are API keys.
 */
export async function addIpRange(ctx: TenantContext, input: AddIpRangeInput): Promise<IpRange> {
  assertOwner(ctx);
  await assertFeature(ctx, "ip-allowlist");

  try {
    return await tenantTransaction(ctx, async (tx) => {
      const count = await tx.ipAllowlistEntry.count({ where: { companyId: ctx.companyId } });
      if (count >= MAX_IP_RANGES) {
        throw new ConflictError(`A workspace can list at most ${MAX_IP_RANGES} ranges. Merge some into wider ones.`);
      }
      const range = await tx.ipAllowlistEntry.create({
        data: { companyId: ctx.companyId, cidr: input.cidr, label: input.label },
        select: RANGE_SELECT,
      });
      await logActivity(
        {
          companyId: ctx.companyId,
          actorId: ctx.actorId,
          action: "company.ip_allowlist_add",
          entityType: "company",
          entityId: ctx.companyId,
          summary: count === 0 ? `turned on IP allowlisting with ${range.cidr}` : `allowed ${range.cidr}`,
          metadata: { cidr: range.cidr, label: range.label },
        },
        tx,
      );
      return range;
    });
  } catch (error) {
    if (isPrismaError(error, "P2002")) throw new ConflictError("That range is already on the list.");
    throw error;
  }
}

/** Never gated by the entitlement, so a workspace that lost it can still lift the restriction. */
export async function removeIpRange(ctx: TenantContext, input: IpRangeIdInput): Promise<IpRange> {
  assertOwner(ctx);

  return tenantTransaction(ctx, async (tx) => {
    const range = await tx.ipAllowlistEntry.findFirst({
      where: { id: input.rangeId, companyId: ctx.companyId },
      select: RANGE_SELECT,
    });
    if (!range) throw new NotFoundError("That range is no longer on the list.");
    await tx.ipAllowlistEntry.delete({ where: { id: range.id, companyId: ctx.companyId } });
    const remaining = await tx.ipAllowlistEntry.count({ where: { companyId: ctx.companyId } });
    await logActivity(
      {
        companyId: ctx.companyId,
        actorId: ctx.actorId,
        action: "company.ip_allowlist_remove",
        entityType: "company",
        entityId: ctx.companyId,
        summary: remaining === 0 ? `turned off IP allowlisting (removed ${range.cidr})` : `stopped allowing ${range.cidr}`,
        metadata: { cidr: range.cidr },
      },
      tx,
    );
    return range;
  });
}
