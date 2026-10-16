import type Stripe from "stripe";
import { describe, expect, it } from "vitest";

import {
  DUNNING_GRACE_DAYS,
  effectivePlan,
  graceEndsAt,
  seatLimit,
  statusFromStripe,
  type BillingAccountState,
} from "../../src/billing/account";
import { toSnapshot } from "../../src/billing/gateway";
import { PLANS, planGrants } from "../../src/billing/plans";
import { describeChange, subscriptionRef } from "../../src/billing/events";
import { FEATURE_FLAGS, FLAGS } from "../../src/flags/registry";
import { decideFlag } from "../../src/flags/resolve";
import { checkoutSchema } from "../../src/validators/billing";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-15T12:00:00Z");

function account(overrides: Partial<BillingAccountState> = {}): BillingAccountState {
  return { plan: "TEAM", status: "ACTIVE", seats: 10, comped: false, pastDueSince: null, ...overrides };
}

describe("effective plan", () => {
  it("is Free without an account", () => {
    expect(effectivePlan(null, NOW)).toBe("FREE");
  });

  it("is the paid plan while active or trialing", () => {
    expect(effectivePlan(account(), NOW)).toBe("TEAM");
    expect(effectivePlan(account({ status: "TRIALING" }), NOW)).toBe("TEAM");
  });

  it("holds through the grace period after a failed payment, then lapses", () => {
    const pastDue = account({ status: "PAST_DUE", pastDueSince: new Date(NOW.getTime() - 3 * DAY) });
    expect(effectivePlan(pastDue, NOW)).toBe("TEAM");
    expect(graceEndsAt(pastDue)?.getTime()).toBe(NOW.getTime() - 3 * DAY + DUNNING_GRACE_DAYS * DAY);
    expect(effectivePlan(pastDue, new Date(NOW.getTime() + DUNNING_GRACE_DAYS * DAY))).toBe("FREE");
  });

  it("falls back to Free for every status that isn't paid for", () => {
    for (const status of ["UNPAID", "CANCELED", "INCOMPLETE", "INCOMPLETE_EXPIRED", "PAUSED"] as const) {
      expect(effectivePlan(account({ status }), NOW)).toBe("FREE");
    }
    expect(effectivePlan(account({ status: null }), NOW)).toBe("FREE");
  });

  it("keeps a comped plan without a subscription", () => {
    expect(effectivePlan(account({ plan: "ENTERPRISE", comped: true, status: null }), NOW)).toBe("ENTERPRISE");
  });
});

describe("seat limits", () => {
  it("caps Free at its included seats and paid plans at the seats bought", () => {
    expect(seatLimit(null, NOW)).toBe(PLANS.FREE.includedSeats);
    expect(seatLimit(account({ seats: 12 }), NOW)).toBe(12);
  });

  it("drops a lapsed subscription to Free's seats and leaves comped plans unlimited", () => {
    expect(seatLimit(account({ status: "CANCELED" }), NOW)).toBe(PLANS.FREE.includedSeats);
    expect(seatLimit(account({ plan: "ENTERPRISE", comped: true, status: null, seats: null }), NOW)).toBeNull();
  });
});

describe("plans and entitlements", () => {
  it("grants the enterprise features only on Enterprise", () => {
    expect(planGrants("ENTERPRISE", "sso")).toBe(true);
    expect(planGrants("TEAM", "sso")).toBe(false);
    expect(planGrants("FREE", "audit-streaming")).toBe(false);
  });

  it("keeps resume file uploads on every plan", () => {
    expect(planGrants("FREE", "resume-files")).toBe(true);
    expect(planGrants("TEAM", "resume-files")).toBe(true);
    expect(planGrants("ENTERPRISE", "resume-files")).toBe(true);
  });

  // With billing on, an entitlement no plan lists is off for everyone.
  it("sells every entitlement on at least one plan", () => {
    const entitlements = FEATURE_FLAGS.filter((flag) => FLAGS[flag].kind === "entitlement");
    for (const flag of entitlements) {
      expect(Object.values(PLANS).some((plan) => plan.entitlements.includes(flag)), flag).toBe(true);
    }
  });

  it("puts the plan after a staff override and before the default", () => {
    expect(decideFlag("sso", "c1", undefined, "FREE")).toEqual({ enabled: false, source: "plan" });
    expect(decideFlag("sso", "c1", true, "FREE")).toEqual({ enabled: true, source: "override" });
    expect(decideFlag("sso", "c1", undefined, null)).toEqual({ enabled: true, source: "default" });
  });

  it("only sells the paid plans", () => {
    expect(checkoutSchema.safeParse({ plan: "TEAM" }).success).toBe(true);
    expect(checkoutSchema.safeParse({ plan: "FREE" }).success).toBe(false);
  });
});

describe("Stripe statuses", () => {
  it("maps known statuses and treats anything new as unpaid", () => {
    expect(statusFromStripe("past_due")).toBe("PAST_DUE");
    expect(statusFromStripe("incomplete_expired")).toBe("INCOMPLETE_EXPIRED");
    expect(statusFromStripe("something_new")).toBe("INCOMPLETE");
    expect(statusFromStripe("toString")).toBe("INCOMPLETE");
  });
});

describe("Stripe events", () => {
  function event(type: string, object: Record<string, unknown>): Stripe.Event {
    return JSON.parse(JSON.stringify({ id: "evt_1", object: "event", type, data: { object } })) as Stripe.Event;
  }

  it("finds the subscription each handled event is about", () => {
    expect(
      subscriptionRef(
        event("checkout.session.completed", { mode: "subscription", subscription: "sub_1", client_reference_id: "co_1" }),
      ),
    ).toEqual({ subscriptionId: "sub_1", companyId: "co_1" });
    expect(subscriptionRef(event("customer.subscription.deleted", { id: "sub_2" }))).toEqual({
      subscriptionId: "sub_2",
      companyId: null,
    });
    expect(
      subscriptionRef(event("invoice.payment_failed", { parent: { subscription_details: { subscription: "sub_3" } } })),
    ).toEqual({ subscriptionId: "sub_3", companyId: null });
  });

  it("ignores one-off payments and events it doesn't handle", () => {
    expect(subscriptionRef(event("checkout.session.completed", { mode: "payment", subscription: null }))).toBeNull();
    expect(subscriptionRef(event("invoice.paid", { parent: null }))).toBeNull();
    expect(subscriptionRef(event("customer.created", { id: "cus_1" }))).toBeNull();
  });

  it("reads the period and quantity from the subscription item", () => {
    const snapshot = toSnapshot(
      JSON.parse(
        JSON.stringify({
          id: "sub_1",
          customer: "cus_1",
          status: "active",
          cancel_at_period_end: true,
          metadata: { companyId: "co_1" },
          items: { data: [{ price: { id: "price_team" }, quantity: 7, current_period_start: 1_000, current_period_end: 2_000 }] },
        }),
      ) as Stripe.Subscription,
    );
    expect(snapshot).toEqual({
      id: "sub_1",
      customerId: "cus_1",
      status: "active",
      priceId: "price_team",
      quantity: 7,
      periodStart: new Date(1_000_000),
      periodEnd: new Date(2_000_000),
      cancelAtPeriodEnd: true,
      companyId: "co_1",
    });
  });
});

describe("billing activity", () => {
  const row = {
    plan: "TEAM" as const,
    status: "ACTIVE" as const,
    seats: 5,
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: "sub_1",
    cancelAtPeriodEnd: false,
    pastDueSince: null,
    meteredThrough: null,
  };

  it("words each change a person would care about", () => {
    expect(describeChange(null, row, NOW)).toBe("subscribed to Team with 5 seats");
    expect(describeChange(row, { ...row, plan: "ENTERPRISE" }, NOW)).toBe("changed the plan to Enterprise");
    expect(describeChange(row, { ...row, seats: 8 }, NOW)).toBe("changed the seats from 5 to 8");
    expect(describeChange(row, { ...row, cancelAtPeriodEnd: true }, NOW)).toBe(
      "set the subscription to end with the current period",
    );
    expect(describeChange(row, { ...row, status: "PAST_DUE", pastDueSince: NOW }, NOW)).toBe(
      "a payment failed; Team stays active until 2026-10-29",
    );
    expect(describeChange({ ...row, status: "PAST_DUE" }, row, NOW)).toBe(
      "a payment went through; billing is in good standing",
    );
    expect(describeChange(row, { ...row, status: "CANCELED" }, NOW)).toBe(
      "the subscription ended; the workspace is on Free",
    );
  });

  it("stays quiet when nothing visible changed", () => {
    expect(describeChange(row, row, NOW)).toBeNull();
  });
});
