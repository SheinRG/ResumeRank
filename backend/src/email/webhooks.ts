import { Resend, type WebhookEventPayload } from "resend";

import { env } from "../env";

export interface WebhookSignatureHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

/** Off unless both are set: events only exist for mail Resend sent. */
export function resendWebhooksEnabled(): boolean {
  const { RESEND_API_KEY, RESEND_WEBHOOK_SECRET } = env();
  return Boolean(RESEND_API_KEY && RESEND_WEBHOOK_SECRET);
}

/**
 * The SDK checks the Svix signature over the raw body and rejects stale
 * timestamps, which stops replays. Null for anything that doesn't verify.
 */
export function verifyResendWebhook(
  payload: string,
  headers: WebhookSignatureHeaders,
): WebhookEventPayload | null {
  const { RESEND_API_KEY, RESEND_WEBHOOK_SECRET } = env();
  const { id, timestamp, signature } = headers;
  if (!RESEND_API_KEY || !RESEND_WEBHOOK_SECRET || !id || !timestamp || !signature) return null;
  try {
    return new Resend(RESEND_API_KEY).webhooks.verify({
      payload,
      headers: { id, timestamp, signature },
      webhookSecret: RESEND_WEBHOOK_SECRET,
    });
  } catch {
    return null;
  }
}
