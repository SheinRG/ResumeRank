import type { Prisma } from "../generated/prisma/client";
import { ConflictError } from "../services/errors";
import { BILLING_STATE_SELECT, billingPlan, seatLimit, type BillingAccountState } from "./account";

/**
 * Only what the check needs, so a tenant transaction and an owner one (invite
 * acceptance, SSO auto-join, SCIM) can both run it.
 */
export interface SeatClient {
  $queryRaw<T>(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<T>;
  membership: { count(args: { where: Prisma.MembershipWhereInput }): PromiseLike<number> };
  companyInvite: { count(args: { where: Prisma.CompanyInviteWhereInput }): PromiseLike<number> };
  billingAccount: {
    findUnique(args: {
      where: { companyId: string };
      select: typeof BILLING_STATE_SELECT;
    }): PromiseLike<BillingAccountState | null>;
  };
}

export class SeatLimitError extends ConflictError {}

export function seatLimitMessage(limit: number): string {
  return `All ${limit} seat${limit === 1 ? "" : "s"} on this workspace's plan are taken. An owner can add seats in Settings → Billing.`;
}

export interface SeatCheck {
  /** Invites still waiting hold a seat too, so inviting can't oversell them. */
  countPendingInvites: boolean;
  /** Re-inviting someone already invited replaces their invite rather than taking another seat. */
  excludeInviteEmail?: string;
}

/**
 * Refuses one more member when the plan's seats are all taken. Call it in the
 * transaction that adds the member: the advisory lock makes concurrent joins
 * queue, so two of them can't both take the last seat.
 */
export async function assertSeatAvailable(tx: SeatClient, companyId: string, check: SeatCheck): Promise<void> {
  const account = await tx.billingAccount.findUnique({ where: { companyId }, select: BILLING_STATE_SELECT });
  if (billingPlan(account) === null) return;
  const limit = seatLimit(account);
  if (limit === null) return;

  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`seats:${companyId}`}, 0))::text`;
  const [members, pending] = await Promise.all([
    tx.membership.count({ where: { companyId } }),
    check.countPendingInvites
      ? tx.companyInvite.count({
          where: {
            companyId,
            acceptedAt: null,
            expiresAt: { gt: new Date() },
            ...(check.excludeInviteEmail ? { NOT: { email: check.excludeInviteEmail } } : {}),
          },
        })
      : Promise.resolve(0),
  ]);
  if (members + pending >= limit) throw new SeatLimitError(seatLimitMessage(limit));
}
