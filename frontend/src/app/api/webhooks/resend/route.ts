import { NextResponse } from "next/server";

import { applyEmailEvent } from "@resumerank/core/email/outbox";
import { resendWebhooksEnabled, verifyResendWebhook } from "@resumerank/core/email/webhooks";
import { log } from "@resumerank/core/observability/log";

/**
 * Resend delivery events (bounces, complaints, deliveries). The signature is
 * checked over the raw body before anything is parsed or written; a 2xx
 * tells Resend to stop retrying, so failures to apply are left to surface as 500s.
 */
export async function POST(request: Request): Promise<Response> {
  if (!resendWebhooksEnabled()) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const event = verifyResendWebhook(await request.text(), {
    id: request.headers.get("svix-id"),
    timestamp: request.headers.get("svix-timestamp"),
    signature: request.headers.get("svix-signature"),
  });
  if (!event) {
    log.warn("email.webhook_rejected", {});
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  await applyEmailEvent(event);
  return NextResponse.json({ received: true });
}
