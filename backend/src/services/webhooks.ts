import { logActivity } from "../activity";
import { assertPublicHttpsUrl, OutboundError } from "../audit/outbound";
import { generateSigningSecret } from "../audit/stream-format";
import type { Prisma } from "../generated/prisma/client";
import type { WebhookDeliveryStatus } from "../generated/prisma/enums";
import { tenantDb, tenantTransaction } from "../tenant-db";
import { isWebhookEvent, type CreateWebhookInput, type WebhookEvent } from "../validators/api";
import { sealWebhookSecret, webhookPayload } from "../webhooks/outbox";
import { assertCanAdmin, type TenantContext } from "./context";
import { ConflictError, DomainError, NotFoundError } from "./errors";

export interface WebhookDeliveryView {
  id: string;
  event: string;
  status: WebhookDeliveryStatus;
  attempts: number;
  lastError: string | null;
  createdAt: Date;
  deliveredAt: Date | null;
}

export interface WebhookEndpointView {
  id: string;
  url: string;
  events: WebhookEvent[];
  enabled: boolean;
  lastDeliveredAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  recentDeliveries: WebhookDeliveryView[];
}

export interface CreatedWebhook {
  endpoint: WebhookEndpointView;
  /** Shown once: the receiver verifies `ResumeRank-Signature` with it. */
  signingSecret: string;
}

export const MAX_WEBHOOK_ENDPOINTS = 10;
const RECENT_DELIVERIES = 10;
const ENDPOINT_NOT_FOUND = "That webhook endpoint no longer exists.";

const ENDPOINT_SELECT = {
  id: true,
  url: true,
  events: true,
  enabled: true,
  lastDeliveredAt: true,
  lastError: true,
  createdAt: true,
  deliveries: {
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: RECENT_DELIVERIES,
    select: { id: true, event: true, status: true, attempts: true, lastError: true, createdAt: true, deliveredAt: true },
  },
} satisfies Prisma.WebhookEndpointSelect;

type EndpointRow = Prisma.WebhookEndpointGetPayload<{ select: typeof ENDPOINT_SELECT }>;

function toView({ deliveries, events, ...endpoint }: EndpointRow): WebhookEndpointView {
  return { ...endpoint, events: events.filter(isWebhookEvent), recentDeliveries: deliveries };
}

export async function listWebhooks(ctx: TenantContext): Promise<WebhookEndpointView[]> {
  assertCanAdmin(ctx);
  const rows = await tenantDb(ctx).webhookEndpoint.findMany({
    where: { companyId: ctx.companyId },
    select: ENDPOINT_SELECT,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map(toView);
}

export async function createWebhook(ctx: TenantContext, input: CreateWebhookInput): Promise<CreatedWebhook> {
  assertCanAdmin(ctx);
  let url: string;
  try {
    url = (await assertPublicHttpsUrl(input.url)).toString();
  } catch (error) {
    if (error instanceof OutboundError) throw new DomainError(error.message, { url: [error.message] });
    throw error;
  }
  const signingSecret = generateSigningSecret();

  return tenantTransaction(ctx, async (tx) => {
    const existing = await tx.webhookEndpoint.count({ where: { companyId: ctx.companyId } });
    if (existing >= MAX_WEBHOOK_ENDPOINTS) {
      throw new ConflictError(`A workspace can have up to ${MAX_WEBHOOK_ENDPOINTS} webhook endpoints.`);
    }
    const row = await tx.webhookEndpoint.create({
      data: {
        companyId: ctx.companyId,
        url,
        secret: sealWebhookSecret(signingSecret, ctx.companyId, url),
        events: input.events,
      },
      select: ENDPOINT_SELECT,
    });
    const host = new URL(url).host;
    await logActivity(
      {
        companyId: ctx.companyId,
        actorId: ctx.actorId,
        action: "webhook.create",
        entityType: "company",
        entityId: ctx.companyId,
        summary: `added a webhook endpoint at ${host}`,
        metadata: { endpointId: row.id, host, events: input.events },
      },
      tx,
    );
    return { endpoint: toView(row), signingSecret };
  });
}

/** Pausing keeps queued deliveries; resuming sends them, then everything new. */
export async function setWebhookEnabled(
  ctx: TenantContext,
  input: { id: string; enabled: boolean },
): Promise<WebhookEndpointView> {
  assertCanAdmin(ctx);

  return tenantTransaction(ctx, async (tx) => {
    const { count } = await tx.webhookEndpoint.updateMany({
      where: { id: input.id, companyId: ctx.companyId },
      data: { enabled: input.enabled },
    });
    if (count === 0) throw new NotFoundError(ENDPOINT_NOT_FOUND);
    const row = await tx.webhookEndpoint.findUniqueOrThrow({
      where: { id: input.id, companyId: ctx.companyId },
      select: ENDPOINT_SELECT,
    });
    await logActivity(
      {
        companyId: ctx.companyId,
        actorId: ctx.actorId,
        action: input.enabled ? "webhook.resume" : "webhook.pause",
        entityType: "company",
        entityId: ctx.companyId,
        summary: `${input.enabled ? "resumed" : "paused"} the webhook endpoint at ${new URL(row.url).host}`,
        metadata: { endpointId: row.id },
      },
      tx,
    );
    return toView(row);
  });
}

/** Undelivered events for the endpoint go with it. */
export async function deleteWebhook(ctx: TenantContext, id: string): Promise<{ id: string }> {
  assertCanAdmin(ctx);

  return tenantTransaction(ctx, async (tx) => {
    const endpoint = await tx.webhookEndpoint.findUnique({
      where: { id, companyId: ctx.companyId },
      select: { url: true },
    });
    if (!endpoint) throw new NotFoundError(ENDPOINT_NOT_FOUND);
    await tx.webhookEndpoint.delete({ where: { id, companyId: ctx.companyId } });
    await logActivity(
      {
        companyId: ctx.companyId,
        actorId: ctx.actorId,
        action: "webhook.delete",
        entityType: "company",
        entityId: ctx.companyId,
        summary: `removed the webhook endpoint at ${new URL(endpoint.url).host}`,
        metadata: { endpointId: id },
      },
      tx,
    );
    return { id };
  });
}

/** Queues a `ping` to one endpoint, so a receiver can be tested without moving a candidate. */
export async function sendTestWebhook(ctx: TenantContext, id: string): Promise<WebhookEndpointView> {
  assertCanAdmin(ctx);

  return tenantTransaction(ctx, async (tx) => {
    const endpoint = await tx.webhookEndpoint.findUnique({
      where: { id, companyId: ctx.companyId },
      select: { id: true, enabled: true },
    });
    if (!endpoint) throw new NotFoundError(ENDPOINT_NOT_FOUND);
    if (!endpoint.enabled) throw new DomainError("Resume the endpoint before sending a test event.");

    await tx.webhookDelivery.create({
      data: {
        companyId: ctx.companyId,
        endpointId: endpoint.id,
        event: "ping",
        payload: { ...webhookPayload("ping", { message: "A test event from ResumeRank." }) },
      },
    });
    await logActivity(
      {
        companyId: ctx.companyId,
        actorId: ctx.actorId,
        action: "webhook.test",
        entityType: "company",
        entityId: ctx.companyId,
        summary: "sent a test webhook event",
        metadata: { endpointId: endpoint.id },
      },
      tx,
    );
    return toView(
      await tx.webhookEndpoint.findUniqueOrThrow({ where: { id, companyId: ctx.companyId }, select: ENDPOINT_SELECT }),
    );
  });
}
