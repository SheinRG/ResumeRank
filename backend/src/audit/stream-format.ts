import { createHmac, randomBytes } from "node:crypto";

import type { AuditStreamKind } from "../generated/prisma/enums";
import type { AuditEvent } from "./events";
import type { OutboundRequest } from "./outbound";

/** The secret a webhook receiver checks signatures with; shown once, when it is created. */
export function generateSigningSecret(): string {
  return `whsec_${randomBytes(32).toString("base64url")}`;
}

export const SIGNATURE_HEADER = "ResumeRank-Signature";

/**
 * Stripe-style: the timestamp is signed with the body, so a receiver can
 * reject replays older than its tolerance as well as forgeries.
 */
export function signWebhook(secret: string, body: string, timestampSeconds: number): string {
  const digest = createHmac("sha256", secret).update(`${timestampSeconds}.${body}`).digest("hex");
  return `t=${timestampSeconds},v1=${digest}`;
}

/** Each SIEM's ingestion format for a batch of events. */
export function buildStreamRequest(
  kind: AuditStreamKind,
  secret: string,
  events: readonly AuditEvent[],
  now = new Date(),
): OutboundRequest {
  switch (kind) {
    case "WEBHOOK": {
      const body = JSON.stringify({ events });
      const timestamp = Math.floor(now.getTime() / 1000);
      return {
        body,
        headers: {
          "Content-Type": "application/json",
          [SIGNATURE_HEADER]: signWebhook(secret, body, timestamp),
        },
      };
    }
    case "SPLUNK": {
      // HEC takes concatenated event objects, not an array.
      const body = events
        .map((event) =>
          JSON.stringify({
            time: Date.parse(event.timestamp) / 1000,
            source: "resumerank",
            sourcetype: "resumerank:audit",
            event,
          }),
        )
        .join("\n");
      return { body, headers: { "Content-Type": "application/json", Authorization: `Splunk ${secret}` } };
    }
    case "DATADOG": {
      // The event sits under one attribute so its keys can't collide with
      // Datadog's reserved ones (status, host, service).
      const body = JSON.stringify(
        events.map((event) => ({
          ddsource: "resumerank",
          service: "resumerank-audit",
          timestamp: event.timestamp,
          message: `${event.actorName ?? "ResumeRank"} ${event.summary}`,
          audit: event,
        })),
      );
      return { body, headers: { "Content-Type": "application/json", "DD-API-KEY": secret } };
    }
  }
}

const MAX_BACKOFF_MS = 60 * 60 * 1000;

/** One minute, doubling per consecutive failure, capped at an hour. */
export function streamBackoffMs(failures: number): number {
  return Math.min(MAX_BACKOFF_MS, 60_000 * 2 ** Math.max(0, failures - 1));
}
