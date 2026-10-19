import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { env } from "../env";

export interface WebhookSignatureHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

const recipients = z.union([z.string(), z.array(z.string())]).transform((to) => (Array.isArray(to) ? to : [to]));

const eventBase = { created_at: z.string() };
const dataBase = { email_id: z.string(), to: recipients };

/** Only the fields `applyEmailEvent` reads; every other event type is accepted and ignored. */
export const emailEventSchema = z.discriminatedUnion("type", [
  z.object({ ...eventBase, type: z.literal("email.delivered"), data: z.object(dataBase) }),
  z.object({
    ...eventBase,
    type: z.literal("email.bounced"),
    data: z.object({
      ...dataBase,
      bounce: z.object({ type: z.string(), subType: z.string(), message: z.string() }),
    }),
  }),
  z.object({ ...eventBase, type: z.literal("email.complained"), data: z.object(dataBase) }),
  z.object({ ...eventBase, type: z.literal("other") }),
]);

export type EmailEvent = z.infer<typeof emailEventSchema>;

const HANDLED_EVENTS: ReadonlySet<string> = new Set(["email.delivered", "email.bounced", "email.complained"]);

/** Off unless the signing secret is set: without it no event can be trusted. */
export function resendWebhooksEnabled(): boolean {
  return Boolean(env().RESEND_WEBHOOK_SECRET);
}

/** Svix rejects replays outside this window, and so do we. */
const TOLERANCE_SECONDS = 5 * 60;

/**
 * Resend signs with Svix: HMAC-SHA256 over `id.timestamp.body` keyed by the
 * base64 secret after `whsec_`, sent as space-separated `v1,<base64>`
 * signatures (several while a secret rotates). Checked over the raw body.
 */
export function verifySvixSignature(
  payload: string,
  headers: WebhookSignatureHeaders,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > TOLERANCE_SECONDS) return false;

  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret, "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${payload}`).digest();
  return signature.split(" ").some((entry) => {
    const [version, value] = entry.split(",");
    if (version !== "v1" || !value) return false;
    const given = Buffer.from(value, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

/** Null for anything that doesn't verify or doesn't parse. */
export function verifyResendWebhook(payload: string, headers: WebhookSignatureHeaders): EmailEvent | null {
  const secret = env().RESEND_WEBHOOK_SECRET;
  if (!secret || !verifySvixSignature(payload, headers, secret)) return null;
  let body: unknown;
  try {
    body = JSON.parse(payload);
  } catch {
    return null;
  }
  const envelope = z.looseObject({ type: z.string() }).safeParse(body);
  if (!envelope.success) return null;
  const event = HANDLED_EVENTS.has(envelope.data.type) ? envelope.data : { ...envelope.data, type: "other" };
  const parsed = emailEventSchema.safeParse(event);
  return parsed.success ? parsed.data : null;
}
