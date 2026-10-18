import { randomUUID } from "node:crypto";

import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Billing is off in every other suite; `env()` is read when `db` is imported,
// so these have to be set before any import runs.
const STRIPE_ENV = vi.hoisted(() => {
  const values = {
    STRIPE_SECRET_KEY: "sk_test_integration",
    STRIPE_WEBHOOK_SECRET: "whsec_integration_test_secret",
    STRIPE_PRICE_TEAM: "price_team_test",
    STRIPE_PRICE_ENTERPRISE: "price_enterprise_test",
    STRIPE_AI_METER_EVENT: "resumerank_ai_tokens",
  };
  Object.assign(process.env, values);
  return values;
});

import { effectivePlan } from "../../src/billing/account";
import type { BillingGateway, SubscriptionSnapshot, UsageInput } from "../../src/billing/gateway";
import { verifyStripeEvent } from "../../src/billing/gateway";
import { reportAiUsage } from "../../src/billing/metering";
import { SeatLimitError } from "../../src/billing/seats";
import { applyStripeEvent } from "../../src/billing/webhooks";
import { acceptInvite } from "../../src/auth/workspaces";
import { assertAiBudget, chargeAiTokens, getAiBudget } from "../../src/ai-budget";
import { db } from "../../src/db";
import { listActivity } from "../../src/services/activity";
import { getBillingOverview, openBillingPortal, startCheckout } from "../../src/services/billing";
import type { TenantContext } from "../../src/services/context";
import { FeatureUnavailableError, ForbiddenError, NotFoundError } from "../../src/services/errors";
import { getFeatures } from "../../src/services/features";
import { setSsoEnforced } from "../../src/services/sso";
import { inviteMember } from "../../src/services/team";
import { tenantTransaction } from "../../src/tenant-db";
import { createTenant, destroyTenant, type TenantFixture } from "./fixtures";

const DAY = 24 * 60 * 60 * 1000;

class FakeStripe implements BillingGateway {
  subscriptions = new Map<string, SubscriptionSnapshot>();
  customers: string[] = [];
  checkouts: Array<{ customerId: string; priceId: string; quantity: number }> = [];
  usage: UsageInput[] = [];

  async createCustomer({ companyId }: { companyId: string }): Promise<string> {
    const id = `cus_${companyId}`;
    this.customers.push(id);
    return id;
  }
  async createCheckoutSession(input: { customerId: string; priceId: string; quantity: number }): Promise<string> {
    this.checkouts.push(input);
    return "https://checkout.stripe.test/session";
  }
  async createPortalSession(): Promise<string> {
    return "https://billing.stripe.test/portal";
  }
  async retrieveSubscription(id: string): Promise<SubscriptionSnapshot> {
    const subscription = this.subscriptions.get(id);
    if (!subscription) throw new Error(`No such subscription: ${id}`);
    return subscription;
  }
  async reportUsage(input: UsageInput): Promise<void> {
    this.usage.push(input);
  }
  async cancelSubscription(id: string): Promise<void> {
    this.subscriptions.delete(id);
  }
}

/** Signs a payload the way Stripe does and runs it through the real verification. */
function signedEvent(type: string, object: Record<string, unknown>): Stripe.Event {
  const payload = JSON.stringify({
    id: `evt_${randomUUID()}`,
    object: "event",
    type,
    api_version: "2026-09-30.endive",
    created: Math.floor(Date.now() / 1000),
    data: { object },
  });
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: STRIPE_ENV.STRIPE_WEBHOOK_SECRET });
  const event = verifyStripeEvent(payload, header);
  if (!event) throw new Error("The test event didn't verify.");
  return event;
}

function subscription(
  companyId: string,
  overrides: Partial<SubscriptionSnapshot> = {},
): SubscriptionSnapshot {
  return {
    id: `sub_${randomUUID()}`,
    customerId: `cus_${companyId}`,
    status: "active",
    priceId: STRIPE_ENV.STRIPE_PRICE_TEAM,
    quantity: 5,
    periodStart: new Date(Date.now() - DAY),
    periodEnd: new Date(Date.now() + 29 * DAY),
    cancelAtPeriodEnd: false,
    companyId,
    ...overrides,
  };
}

const updated = (snapshot: SubscriptionSnapshot) =>
  signedEvent("customer.subscription.updated", { id: snapshot.id, object: "subscription" });

let free: TenantFixture;
let paid: TenantFixture;
const extraUsers: string[] = [];

beforeAll(async () => {
  [free, paid] = await Promise.all([createTenant("billing-free"), createTenant("billing-paid")]);
});

afterAll(async () => {
  await Promise.all([free, paid].filter(Boolean).map(destroyTenant));
  await db.user.deleteMany({ where: { id: { in: extraUsers } } });
  for (const key of Object.keys(STRIPE_ENV)) delete process.env[key];
  await db.$disconnect();
});

function admin(fixture: TenantFixture): TenantContext {
  return { ...fixture.owner, role: "ADMIN" };
}

describe("the Free plan", () => {
  it("is what a company without a billing account gets", async () => {
    const overview = await getBillingOverview(free.owner);
    expect(overview).toMatchObject({ enabled: true, plan: "FREE", status: null, seats: { used: 3, limit: 3 } });
    expect(await getFeatures(free.owner)).toEqual({ "resume-files": true, sso: false, "directory-sync": false, "audit-streaming": false, "ip-allowlist": false });
    expect((await getAiBudget(free.companyId)).budget).toBe(250_000);
  });

  it("gates the enterprise features and names the upgrade", async () => {
    await expect(setSsoEnforced(free.owner, { enforced: true })).rejects.toThrow(
      "Single sign-on isn't included in this workspace's plan. An owner can upgrade in Settings → Billing.",
    );
    await expect(setSsoEnforced(free.owner, { enforced: true })).rejects.toBeInstanceOf(FeatureUnavailableError);
  });

  it("refuses an invite once every seat is taken or held by an invite", async () => {
    await expect(
      inviteMember(free.owner, { email: `extra-${randomUUID()}@example.test`, role: "MEMBER" }),
    ).rejects.toBeInstanceOf(SeatLimitError);
  });

  it("refuses to accept an invite when the plan is full", async () => {
    const invite = await db.companyInvite.findUniqueOrThrow({ where: { id: free.inviteId } });
    const user = await db.user.create({ data: { name: "Late joiner", email: invite.email } });
    extraUsers.push(user.id);
    await expect(
      acceptInvite({ userId: user.id, loginId: "no-session", email: user.email, name: user.name }, invite.id),
    ).rejects.toBeInstanceOf(SeatLimitError);
    expect(await db.membership.count({ where: { userId: user.id } })).toBe(0);
  });

  it("stops scoring at the plan's AI budget", async () => {
    await db.company.update({ where: { id: free.companyId }, data: { aiTokenBudget: null } });
    await chargeAiTokens(free.companyId, 250_000);
    await expect(assertAiBudget(free.companyId)).rejects.toThrow(/plan's AI budget/);
  });
});

describe("comped plans", () => {
  it("keep every feature and every seat for workspaces from before billing", async () => {
    const comped = await createTenant("billing-comped");
    try {
      await db.billingAccount.create({ data: { companyId: comped.companyId, plan: "ENTERPRISE", comped: true } });
      expect(await getFeatures(comped.owner)).toEqual({ "resume-files": true, sso: true, "directory-sync": true, "audit-streaming": true, "ip-allowlist": true });
      expect((await getBillingOverview(comped.owner)).seats.limit).toBeNull();
    } finally {
      await destroyTenant(comped);
    }
  });
});

describe("checkout and the Stripe webhook", () => {
  const stripe = new FakeStripe();
  let live: SubscriptionSnapshot;

  it("lets only an owner start checkout, with a seat per member", async () => {
    await expect(startCheckout(admin(paid), { plan: "TEAM" }, stripe)).rejects.toBeInstanceOf(ForbiddenError);

    const { url } = await startCheckout(paid.owner, { plan: "TEAM" }, stripe);
    expect(url).toBe("https://checkout.stripe.test/session");
    expect(stripe.checkouts.at(-1)).toEqual(
      expect.objectContaining({ customerId: `cus_${paid.companyId}`, priceId: STRIPE_ENV.STRIPE_PRICE_TEAM, quantity: 3 }),
    );
    const account = await db.billingAccount.findUniqueOrThrow({ where: { companyId: paid.companyId } });
    expect(account).toMatchObject({ stripeCustomerId: `cus_${paid.companyId}`, plan: "FREE", status: null });

    await startCheckout(paid.owner, { plan: "TEAM" }, stripe);
    expect(stripe.customers).toHaveLength(1);
  });

  it("changes nothing until Stripe confirms, then applies the subscription once", async () => {
    expect((await getBillingOverview(paid.owner)).plan).toBe("FREE");

    live = subscription(paid.companyId);
    stripe.subscriptions.set(live.id, live);
    const completed = signedEvent("checkout.session.completed", {
      id: "cs_test",
      object: "checkout.session",
      mode: "subscription",
      subscription: live.id,
      client_reference_id: paid.companyId,
    });
    expect(await applyStripeEvent(completed, stripe)).toBe("applied");
    expect(await applyStripeEvent(completed, stripe)).toBe("duplicate");

    const overview = await getBillingOverview(paid.owner);
    expect(overview).toMatchObject({ plan: "TEAM", status: "ACTIVE", seats: { used: 3, limit: 5 } });
    expect((await getAiBudget(paid.companyId)).budget).toBe(5_000_000);
    expect((await getFeatures(paid.owner)).sso).toBe(false);

    const feed = await listActivity(paid.owner, {});
    const entries = feed.items.filter((item) => item.action === "billing.subscription");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ summary: "subscribed to Team with 5 seats", actor: { name: "ResumeRank" } });
  });

  it("refuses a second checkout while subscribed", async () => {
    await expect(startCheckout(paid.owner, { plan: "ENTERPRISE" }, stripe)).rejects.toThrow(/Manage billing/);
  });

  it("follows an upgrade made in the portal", async () => {
    live = { ...live, priceId: STRIPE_ENV.STRIPE_PRICE_ENTERPRISE, quantity: 8 };
    stripe.subscriptions.set(live.id, live);
    expect(await applyStripeEvent(updated(live), stripe)).toBe("applied");
    expect(await getFeatures(paid.owner)).toEqual({ "resume-files": true, sso: true, "directory-sync": true, "audit-streaming": true, "ip-allowlist": true });
    expect((await getBillingOverview(paid.owner)).seats.limit).toBe(8);
  });

  it("keeps the plan through the grace period after a failed payment, then falls back to Free", async () => {
    live = { ...live, status: "past_due" };
    stripe.subscriptions.set(live.id, live);
    const failed = signedEvent("invoice.payment_failed", {
      id: "in_test",
      object: "invoice",
      parent: { type: "subscription_details", subscription_details: { subscription: live.id, metadata: {} } },
    });
    expect(await applyStripeEvent(failed, stripe)).toBe("applied");

    const account = await db.billingAccount.findUniqueOrThrow({ where: { companyId: paid.companyId } });
    expect(account.status).toBe("PAST_DUE");
    expect(account.pastDueSince).not.toBeNull();
    expect((await getBillingOverview(paid.owner)).plan).toBe("ENTERPRISE");
    expect(effectivePlan(account, new Date(Date.now() + 15 * DAY))).toBe("FREE");

    const feed = await listActivity(paid.owner, {});
    expect(feed.items.some((item) => item.summary.startsWith("a payment failed; Enterprise stays active until"))).toBe(true);

    live = { ...live, status: "active" };
    stripe.subscriptions.set(live.id, live);
    expect(await applyStripeEvent(updated(live), stripe)).toBe("applied");
    expect((await db.billingAccount.findUniqueOrThrow({ where: { companyId: paid.companyId } })).pastDueSince).toBeNull();
  });

  it("ignores a late event about a subscription that has been replaced", async () => {
    const old = subscription(paid.companyId, { status: "canceled" });
    stripe.subscriptions.set(old.id, old);
    expect(await applyStripeEvent(updated(old), stripe)).toBe("ignored");
    expect((await getBillingOverview(paid.owner)).plan).toBe("ENTERPRISE");
  });

  it("records but ignores a subscription to a price no plan uses", async () => {
    const stray = subscription(paid.companyId, { priceId: "price_unknown" });
    stripe.subscriptions.set(stray.id, stray);
    const event = updated(stray);
    expect(await applyStripeEvent(event, stripe)).toBe("ignored");
    expect(await db.stripeEvent.count({ where: { id: event.id } })).toBe(1);
  });

  it("opens the portal only for a company with a customer", async () => {
    expect(await openBillingPortal(paid.owner, stripe)).toEqual({ url: "https://billing.stripe.test/portal" });
    await expect(openBillingPortal(free.owner, stripe)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("reports finished scoring runs to the meter once each", async () => {
    const account = await db.billingAccount.findUniqueOrThrow({ where: { companyId: paid.companyId } });
    const finishedAt = new Date(Date.now() - 10 * 60 * 1000);
    expect(account.meteredThrough?.getTime()).toBeLessThan(finishedAt.getTime() + 10 * 60 * 1000);
    await db.billingAccount.update({
      where: { companyId: paid.companyId },
      data: { meteredThrough: new Date(finishedAt.getTime() - 1000) },
    });
    // Finished runs are immutable; only maintenance may restage one as fixture data.
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.scoring_maintenance', 'on', true)`;
      await tx.scoringRun.update({
        where: { id: paid.scoringRunId },
        data: { finishedAt, promptTokens: 1200, completionTokens: 300 },
      });
    });

    expect((await reportAiUsage({ gateway: stripe })).reported).toBeGreaterThanOrEqual(1);
    expect(stripe.usage.filter((usage) => usage.identifier === `scoring-run:${paid.scoringRunId}`)).toEqual([
      expect.objectContaining({ customerId: `cus_${paid.companyId}`, tokens: 1500 }),
    ]);

    await reportAiUsage({ gateway: stripe });
    expect(stripe.usage.filter((usage) => usage.identifier === `scoring-run:${paid.scoringRunId}`)).toHaveLength(1);
  });

  it("ends the plan when the subscription is deleted", async () => {
    live = { ...live, status: "canceled" };
    stripe.subscriptions.set(live.id, live);
    const deleted = signedEvent("customer.subscription.deleted", { id: live.id, object: "subscription" });
    expect(await applyStripeEvent(deleted, stripe)).toBe("applied");
    expect((await getBillingOverview(paid.owner)).plan).toBe("FREE");
  });
});

describe("webhook signatures", () => {
  it("rejects a tampered body or a wrong secret", () => {
    const payload = JSON.stringify({ id: "evt_1", object: "event", type: "invoice.paid", data: { object: {} } });
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: STRIPE_ENV.STRIPE_WEBHOOK_SECRET });
    expect(verifyStripeEvent(payload, header)?.id).toBe("evt_1");
    expect(verifyStripeEvent(payload.replace("evt_1", "evt_2"), header)).toBeNull();
    const forged = Stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_someone_else" });
    expect(verifyStripeEvent(payload, forged)).toBeNull();
    expect(verifyStripeEvent(payload, null)).toBeNull();
  });
});

describe("billing tenancy", () => {
  it("lets a tenant attach a customer but never grant itself a plan", async () => {
    await expect(
      tenantTransaction(free.owner, (tx) =>
        tx.$executeRaw`UPDATE "BillingAccount" SET "plan" = 'ENTERPRISE' WHERE "companyId" = ${free.companyId}`,
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      tenantTransaction(free.owner, (tx) =>
        tx.$executeRaw`INSERT INTO "BillingAccount" ("id", "companyId", "plan", "comped", "updatedAt")
          VALUES (${randomUUID()}, ${free.companyId}, 'ENTERPRISE', true, now())`,
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("reports only the caller's own billing", async () => {
    const overview = await getBillingOverview(free.owner);
    expect(overview.hasCustomer).toBe(false);
    expect(overview.seats.used).toBe(await db.membership.count({ where: { companyId: free.companyId } }));
  });
});
