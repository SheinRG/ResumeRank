import type Stripe from "stripe";

import { db } from "../db";
import { logActivity } from "../activity";
import type { Prisma } from "../generated/prisma/client";
import { log } from "../observability/log";
import { isPrismaError } from "../services/prisma-errors";
import { statusFromStripe } from "./account";
import {
  ACCOUNT_SELECT,
  describeChange,
  LIVE,
  PAID,
  subscriptionRef,
  type SubscriptionRef,
} from "./events";
import { stripeGateway, type BillingGateway, type SubscriptionSnapshot } from "./gateway";
import type { Plan } from "./plans";
import { planForPrice } from "./prices";

export type StripeEventOutcome = "applied" | "duplicate" | "ignored";

async function recordEvent(tx: Prisma.TransactionClient, event: Stripe.Event): Promise<boolean> {
  try {
    await tx.stripeEvent.create({ data: { id: event.id, type: event.type } });
    return true;
  } catch (error) {
    if (isPrismaError(error, "P2002")) return false;
    throw error;
  }
}

async function resolveCompany(ref: SubscriptionRef, snapshot: SubscriptionSnapshot): Promise<string | null> {
  const fromStripe = snapshot.companyId ?? ref.companyId;
  if (fromStripe) return fromStripe;
  const account = await db.billingAccount.findUnique({
    where: { stripeCustomerId: snapshot.customerId },
    select: { companyId: true },
  });
  return account?.companyId ?? null;
}

/**
 * Applies one Stripe event. The subscription is always re-read from Stripe
 * rather than taken from the payload, so events arriving late or out of
 * order still leave the latest state behind. The event id is recorded in the
 * same transaction as its effect: a redelivery finds it and does nothing, and
 * a failed apply leaves no record, so Stripe's retry runs it again.
 */
export async function applyStripeEvent(
  event: Stripe.Event,
  gateway: BillingGateway = stripeGateway(),
  now: Date = new Date(),
): Promise<StripeEventOutcome> {
  if (await db.stripeEvent.findUnique({ where: { id: event.id }, select: { id: true } })) return "duplicate";

  const ref = subscriptionRef(event);
  if (!ref) {
    const recorded = await db.$transaction((tx) => recordEvent(tx, event));
    return recorded ? "ignored" : "duplicate";
  }

  const snapshot = await gateway.retrieveSubscription(ref.subscriptionId);
  const companyId = await resolveCompany(ref, snapshot);
  const plan: Plan | null = planForPrice(snapshot.priceId);
  if (!companyId || !plan) {
    log.error("billing.event_unmatched", { eventId: event.id, type: event.type, companyId, priceId: snapshot.priceId });
    const recorded = await db.$transaction((tx) => recordEvent(tx, event));
    return recorded ? "ignored" : "duplicate";
  }

  return db.$transaction(async (tx) => {
    if (!(await recordEvent(tx, event))) return "duplicate";

    const company = await tx.company.findUnique({ where: { id: companyId }, select: { id: true } });
    const before = await tx.billingAccount.findUnique({ where: { companyId }, select: ACCOUNT_SELECT });
    if (!company) {
      log.error("billing.event_unmatched", { eventId: event.id, type: event.type, companyId, reason: "no_company" });
      return "ignored";
    }
    if (before?.stripeCustomerId && before.stripeCustomerId !== snapshot.customerId) {
      log.error("billing.customer_mismatch", { eventId: event.id, companyId });
      return "ignored";
    }

    const status = statusFromStripe(snapshot.status);
    // A late event about a subscription the company has since replaced
    // mustn't overwrite the live one.
    if (before?.stripeSubscriptionId && before.stripeSubscriptionId !== snapshot.id && !LIVE.has(status)) {
      return "ignored";
    }

    const data = {
      plan,
      status,
      seats: snapshot.quantity,
      comped: false,
      stripeCustomerId: snapshot.customerId,
      stripeSubscriptionId: snapshot.id,
      stripePriceId: snapshot.priceId,
      currentPeriodStart: snapshot.periodStart,
      currentPeriodEnd: snapshot.periodEnd,
      cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
      pastDueSince: status === "PAST_DUE" ? (before?.pastDueSince ?? now) : null,
      meteredThrough: before?.meteredThrough ?? (PAID.has(status) ? now : null),
    };
    const after = await tx.billingAccount.upsert({
      where: { companyId },
      create: { companyId, ...data },
      update: data,
      select: ACCOUNT_SELECT,
    });

    const summary = describeChange(before, after, now);
    if (summary) {
      await logActivity(
        {
          companyId,
          actorId: null,
          action: "billing.subscription",
          entityType: "company",
          entityId: companyId,
          summary,
          metadata: { plan: after.plan, status: after.status, seats: after.seats, event: event.type },
        },
        tx,
      );
    }
    return "applied";
  });
}
