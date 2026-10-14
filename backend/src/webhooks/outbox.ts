import { randomUUID } from "node:crypto";

import { env } from "../env";
import type { Prisma } from "../generated/prisma/client";
import { open, seal, subkey } from "../sealed-box";
import type { TenantTx } from "../tenant-db";
import type { WebhookEvent } from "../validators/api";

/** `ping` is only ever sent on request, to one endpoint, so nobody subscribes to it. */
export type WebhookEventType = WebhookEvent | "ping";

export interface WebhookPayload {
  /** The same for every endpoint and retry of one event: receivers dedupe on it. */
  id: string;
  type: WebhookEventType;
  createdAt: string;
  data: Prisma.InputJsonObject;
}

const KEY_INFO = "resumerank:webhooks:v1";

let cachedKey: { secret: string; key: Buffer } | null = null;

function key(): Buffer {
  const secret = env().AUTH_SECRET;
  if (cachedKey?.secret !== secret) cachedKey = { secret, key: subkey(secret, KEY_INFO) };
  return cachedKey.key;
}

/** Bound to the company and URL, so a secret moved to another row or address won't open. */
function associatedData(companyId: string, url: string): string {
  return `${companyId}\n${url}`;
}

export function sealWebhookSecret(secret: string, companyId: string, url: string): string {
  return seal(secret, associatedData(companyId, url), key());
}

export function openWebhookSecret(sealed: string, companyId: string, url: string): string | null {
  return open(sealed, associatedData(companyId, url), key());
}

export function webhookPayload(
  type: WebhookEventType,
  data: Prisma.InputJsonObject,
  now = new Date(),
): WebhookPayload {
  return { id: `evt_${randomUUID()}`, type, createdAt: now.toISOString(), data };
}

/**
 * Queues the event for every endpoint subscribed to it, inside the
 * transaction that caused it: the event goes out if and only if the change
 * committed. Delivery happens later, off the request; a paused endpoint's
 * events wait in the queue until it is resumed.
 */
export async function queueWebhookEvent(
  tx: TenantTx,
  companyId: string,
  event: WebhookEvent,
  data: Prisma.InputJsonObject,
): Promise<number> {
  const endpoints = await tx.webhookEndpoint.findMany({
    where: { companyId, events: { has: event } },
    select: { id: true },
  });
  if (endpoints.length === 0) return 0;
  const payload = webhookPayload(event, data);
  await tx.webhookDelivery.createMany({
    data: endpoints.map((endpoint) => ({
      companyId,
      endpointId: endpoint.id,
      event,
      payload: { ...payload },
    })),
  });
  return endpoints.length;
}
