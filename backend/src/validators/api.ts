import { z } from "zod";

import { applicationCreateSchema } from "./application";
import { stageSchema } from "./enums";

/**
 * What a key may do on top of its creator's role. Reads and writes are split
 * so a reporting integration can't change the pipeline.
 */
export const API_SCOPES = [
  "jobs:read",
  "candidates:read",
  "candidates:write",
  "applications:read",
  "applications:write",
  "scoring:write",
] as const;
export type ApiScope = (typeof API_SCOPES)[number];
export const apiScopeSchema = z.enum(API_SCOPES);

export function isApiScope(value: string): value is ApiScope {
  return API_SCOPES.some((scope) => scope === value);
}

export const WEBHOOK_EVENTS = [
  "application.created",
  "application.stage_changed",
  "application.scored",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
export const webhookEventSchema = z.enum(WEBHOOK_EVENTS);

export function isWebhookEvent(value: string): value is WebhookEvent {
  return WEBHOOK_EVENTS.some((event) => event === value);
}

/** Days a new key lives; null never expires. */
export const API_KEY_LIFETIMES = [30, 90, 365] as const;

export const createApiKeySchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters")
    .max(60, "Name must be at most 60 characters"),
  scopes: z.array(apiScopeSchema).min(1, "Choose at least one permission").transform((s) => [...new Set(s)]),
  expiresInDays: z.union([z.literal(30), z.literal(90), z.literal(365)]).nullable(),
});
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;

export const revokeApiKeySchema = z.object({ id: z.string().min(1) });

export const createWebhookSchema = z.object({
  url: z.string().trim().min(1, "Enter the endpoint URL").max(2048, "That URL is too long"),
  events: z.array(webhookEventSchema).min(1, "Choose at least one event").transform((e) => [...new Set(e)]),
});
export type CreateWebhookInput = z.infer<typeof createWebhookSchema>;

export const webhookIdSchema = z.object({ id: z.string().min(1) });

export const setWebhookEnabledSchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean(),
});

/** `POST /api/v1/applications`: the same shape the app's attach-candidate form sends. */
export const apiApplicationCreateSchema = applicationCreateSchema;

/** `PATCH /api/v1/applications/{id}`: only the stage moves through the API. */
export const apiApplicationPatchSchema = z.object({ stage: stageSchema }).strict();
