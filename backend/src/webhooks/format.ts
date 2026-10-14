import type { OutboundRequest } from "../audit/outbound";
import { SIGNATURE_HEADER, signWebhook } from "../audit/stream-format";
import type { Prisma } from "../generated/prisma/client";

/** Signed the same way as the audit log's webhook stream, so one verifier handles both. */
export function buildWebhookRequest(
  delivery: { id: string; event: string; payload: Prisma.JsonValue },
  secret: string,
  now: Date,
): OutboundRequest {
  const body = JSON.stringify(delivery.payload);
  return {
    body,
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "ResumeRank-Webhooks/1",
      "ResumeRank-Event": delivery.event,
      "ResumeRank-Delivery": delivery.id,
      [SIGNATURE_HEADER]: signWebhook(secret, body, Math.floor(now.getTime() / 1000)),
    },
  };
}
