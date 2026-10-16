import Stripe from "stripe";

import { env } from "../env";

/** The parts of a Stripe subscription billing keeps, read fresh from Stripe. */
export interface SubscriptionSnapshot {
  id: string;
  customerId: string;
  status: string;
  priceId: string | null;
  quantity: number | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  /** Set by our checkout; null on a subscription made some other way. */
  companyId: string | null;
}

export interface CheckoutInput {
  customerId: string;
  companyId: string;
  priceId: string;
  quantity: number;
  successUrl: string;
  cancelUrl: string;
}

export interface UsageInput {
  customerId: string;
  tokens: number;
  /** Stripe drops a repeated identifier, so a re-sent report counts once. */
  identifier: string;
  timestamp: Date;
}

/** Everything billing asks of Stripe, so tests can stand in for it without the network. */
export interface BillingGateway {
  createCustomer(input: { companyId: string; name: string; email: string }): Promise<string>;
  createCheckoutSession(input: CheckoutInput): Promise<string>;
  createPortalSession(input: { customerId: string; returnUrl: string }): Promise<string>;
  retrieveSubscription(id: string): Promise<SubscriptionSnapshot>;
  reportUsage(input: UsageInput): Promise<void>;
}

let cached: { key: string; client: Stripe } | null = null;

function client(): Stripe {
  const key = env().STRIPE_SECRET_KEY;
  if (!key) throw new Error("Billing is off: STRIPE_SECRET_KEY isn't set.");
  if (cached?.key !== key) {
    cached = { key, client: new Stripe(key, { maxNetworkRetries: 2, timeout: 15_000, appInfo: { name: "ResumeRank" } }) };
  }
  return cached.client;
}

function fromSeconds(value: number | undefined): Date | null {
  return value === undefined ? null : new Date(value * 1000);
}

export function toSnapshot(subscription: Stripe.Subscription): SubscriptionSnapshot {
  const [item] = subscription.items.data;
  const customer = subscription.customer;
  return {
    id: subscription.id,
    customerId: typeof customer === "string" ? customer : customer.id,
    status: subscription.status,
    priceId: item?.price.id ?? null,
    quantity: item?.quantity ?? null,
    periodStart: fromSeconds(item?.current_period_start),
    periodEnd: fromSeconds(item?.current_period_end),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    companyId: subscription.metadata.companyId ?? null,
  };
}

export function stripeGateway(): BillingGateway {
  return {
    async createCustomer({ companyId, name, email }) {
      // Keyed on the company, so two quick clicks can't make two customers.
      const customer = await client().customers.create(
        { name, email, metadata: { companyId } },
        { idempotencyKey: `customer:${companyId}` },
      );
      return customer.id;
    },
    async createCheckoutSession(input) {
      const session = await client().checkout.sessions.create({
        mode: "subscription",
        customer: input.customerId,
        client_reference_id: input.companyId,
        line_items: [{ price: input.priceId, quantity: input.quantity }],
        subscription_data: { metadata: { companyId: input.companyId } },
        metadata: { companyId: input.companyId },
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
      });
      if (!session.url) throw new Error("Stripe returned a checkout session without a URL.");
      return session.url;
    },
    async createPortalSession({ customerId, returnUrl }) {
      const session = await client().billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
      return session.url;
    },
    async retrieveSubscription(id) {
      return toSnapshot(await client().subscriptions.retrieve(id));
    },
    async reportUsage({ customerId, tokens, identifier, timestamp }) {
      const eventName = env().STRIPE_AI_METER_EVENT;
      if (!eventName) return;
      await client().billing.meterEvents.create({
        event_name: eventName,
        payload: { stripe_customer_id: customerId, value: String(tokens) },
        identifier,
        timestamp: Math.floor(timestamp.getTime() / 1000),
      });
    },
  };
}

/**
 * Checks Stripe's signature over the raw body, with its default five-minute
 * tolerance against replays. Null for anything that doesn't verify.
 */
export function verifyStripeEvent(rawBody: string, signature: string | null): Stripe.Event | null {
  const secret = env().STRIPE_WEBHOOK_SECRET;
  if (!secret || !signature) return null;
  try {
    return Stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch {
    return null;
  }
}

export function isStripeWebhookEnabled(): boolean {
  const { STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET } = env();
  return Boolean(STRIPE_SECRET_KEY && STRIPE_WEBHOOK_SECRET);
}
