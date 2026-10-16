import { isBillingEnabled } from "../env";
import type { Plan, SubscriptionStatus } from "../generated/prisma/enums";
import { PLANS } from "./plans";

/** How long a past-due subscription keeps its plan while Stripe retries the card. */
export const DUNNING_GRACE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface BillingAccountState {
  plan: Plan;
  status: SubscriptionStatus | null;
  seats: number | null;
  comped: boolean;
  pastDueSince: Date | null;
}

export const BILLING_STATE_SELECT = {
  plan: true,
  status: true,
  seats: true,
  comped: true,
  pastDueSince: true,
} as const;

export function graceEndsAt(account: Pick<BillingAccountState, "pastDueSince">): Date | null {
  return account.pastDueSince ? new Date(account.pastDueSince.getTime() + DUNNING_GRACE_DAYS * DAY_MS) : null;
}

/**
 * The plan a workspace gets right now. A comped plan holds without a
 * subscription; a paid one holds while Stripe says it's paid, and through
 * the grace period after a failed payment. Anything else falls back to Free:
 * a canceled, unpaid or never-completed subscription, or no account at all.
 */
export function effectivePlan(account: BillingAccountState | null, now: Date = new Date()): Plan {
  if (!account) return "FREE";
  if (account.comped) return account.plan;
  switch (account.status) {
    case "ACTIVE":
    case "TRIALING":
      return account.plan;
    case "PAST_DUE": {
      const ends = graceEndsAt(account);
      return ends && now < ends ? account.plan : "FREE";
    }
    default:
      return "FREE";
  }
}

/** Members the workspace may have, or null for no limit. */
export function seatLimit(account: BillingAccountState | null, now: Date = new Date()): number | null {
  const plan = effectivePlan(account, now);
  const included = PLANS[plan].includedSeats;
  if (included !== null) return included;
  if (account?.comped) return null;
  return account?.seats ?? null;
}

const STATUSES: Record<string, SubscriptionStatus> = {
  active: "ACTIVE",
  trialing: "TRIALING",
  past_due: "PAST_DUE",
  unpaid: "UNPAID",
  canceled: "CANCELED",
  incomplete: "INCOMPLETE",
  incomplete_expired: "INCOMPLETE_EXPIRED",
  paused: "PAUSED",
};

/** An unknown future status is treated as not paid for, so it never grants a plan. */
export function statusFromStripe(status: string): SubscriptionStatus {
  return Object.hasOwn(STATUSES, status) ? STATUSES[status] : "INCOMPLETE";
}

/** The plan that gates features and limits, or null while billing is off and nothing is gated. */
export function billingPlan(account: BillingAccountState | null, now: Date = new Date()): Plan | null {
  return isBillingEnabled() ? effectivePlan(account, now) : null;
}
