import type Stripe from "stripe";

import type { Prisma } from "../generated/prisma/client";
import type { SubscriptionStatus } from "../generated/prisma/enums";
import { graceEndsAt } from "./account";
import { PLANS } from "./plans";

/** Statuses that mean the subscription is still the company's live one. */
export const LIVE: ReadonlySet<SubscriptionStatus> = new Set(["ACTIVE", "TRIALING", "PAST_DUE"]);
export const PAID: ReadonlySet<SubscriptionStatus> = new Set(["ACTIVE", "TRIALING"]);

export const ACCOUNT_SELECT = {
  plan: true,
  status: true,
  seats: true,
  stripeCustomerId: true,
  stripeSubscriptionId: true,
  cancelAtPeriodEnd: true,
  pastDueSince: true,
  meteredThrough: true,
} satisfies Prisma.BillingAccountSelect;

export type AccountRow = Prisma.BillingAccountGetPayload<{ select: typeof ACCOUNT_SELECT }>;

export interface SubscriptionRef {
  subscriptionId: string;
  /** From the checkout session, the one place Stripe echoes it before metadata exists. */
  companyId: string | null;
}

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

/** Which subscription an event concerns, or null for events billing doesn't act on. */
export function subscriptionRef(event: Stripe.Event): SubscriptionRef | null {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const subscriptionId = session.mode === "subscription" ? idOf(session.subscription) : null;
      return subscriptionId ? { subscriptionId, companyId: session.client_reference_id } : null;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return { subscriptionId: event.data.object.id, companyId: null };
    case "invoice.paid":
    case "invoice.payment_failed": {
      const subscriptionId = idOf(event.data.object.parent?.subscription_details?.subscription);
      return subscriptionId ? { subscriptionId, companyId: null } : null;
    }
    default:
      return null;
  }
}

function formatDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** What changed, worded for the activity feed; null when nothing a person would care about did. */
export function describeChange(before: AccountRow | null, after: AccountRow, now: Date): string | null {
  const label = PLANS[after.plan].label;
  const status = after.status;
  const wasLive = before?.status ? LIVE.has(before.status) : false;
  if (status && PAID.has(status) && !wasLive) return `subscribed to ${label} with ${after.seats ?? 0} seats`;
  if (status === "PAST_DUE" && before?.status !== "PAST_DUE") {
    const ends = graceEndsAt({ pastDueSince: after.pastDueSince ?? now });
    return `a payment failed; ${label} stays active until ${ends ? formatDay(ends) : "Stripe stops retrying"}`;
  }
  if (status && PAID.has(status) && before?.status === "PAST_DUE") return "a payment went through; billing is in good standing";
  if (status && !LIVE.has(status) && wasLive) return "the subscription ended; the workspace is on Free";
  if (!status || !LIVE.has(status) || !before) return null;
  if (before.plan !== after.plan) return `changed the plan to ${label}`;
  if (before.seats !== after.seats) return `changed the seats from ${before.seats ?? 0} to ${after.seats ?? 0}`;
  if (!before.cancelAtPeriodEnd && after.cancelAtPeriodEnd) return "set the subscription to end with the current period";
  if (before.cancelAtPeriodEnd && !after.cancelAtPeriodEnd) return "kept the subscription going";
  return null;
}
