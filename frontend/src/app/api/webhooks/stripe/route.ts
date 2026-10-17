import { NextResponse } from "next/server";

import { isStripeWebhookEnabled, verifyStripeEvent } from "@resumerank/core/billing/gateway";
import { applyStripeEvent } from "@resumerank/core/billing/webhooks";
import { log } from "@resumerank/core/observability/log";

/**
 * Stripe's subscription and invoice events. The signature is checked over
 * the raw body before anything is parsed or written. Applying is idempotent
 * per event id; a failure answers 500 so Stripe retries it.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isStripeWebhookEnabled()) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const event = verifyStripeEvent(await request.text(), request.headers.get("stripe-signature"));
  if (!event) {
    log.warn("billing.webhook_rejected", {});
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  const outcome = await applyStripeEvent(event);
  log.info("billing.webhook", { eventId: event.id, type: event.type, outcome });
  return NextResponse.json({ received: true });
}
