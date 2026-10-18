"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin, requireRecentAuth, tenantContext } from "@/lib/auth/guards";
import { expireTenantReads } from "@/server/cache-tags";
import { runAction } from "@/server/run-action";
import { scheduleWebhookDrain } from "@/server/webhook-drain";
import {
  createApiKey,
  revokeApiKey,
  type ApiKeyView,
  type CreatedApiKey,
} from "@resumerank/core/services/api-keys";
import {
  createWebhook,
  deleteWebhook,
  sendTestWebhook,
  setWebhookEnabled,
  type CreatedWebhook,
  type WebhookEndpointView,
} from "@resumerank/core/services/webhooks";
import { actionError, actionOk, type ActionResult } from "@resumerank/core/types/action";
import {
  createApiKeySchema,
  createWebhookSchema,
  revokeApiKeySchema,
  setWebhookEnabledSchema,
  webhookIdSchema,
} from "@resumerank/core/validators/api";

const SETTINGS_PATH = "/settings/api";

export async function createApiKeyAction(input: unknown): Promise<ActionResult<CreatedApiKey>> {
  return runAction("createApiKey", async () => {
    const parsed = createApiKeySchema.safeParse(input);
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const admin = await requireAdmin();
    await requireRecentAuth();
    const created = await createApiKey(tenantContext(admin), parsed.data);
    revalidatePath(SETTINGS_PATH);
    expireTenantReads(admin.companyId);
    return actionOk(created);
  });
}

export async function revokeApiKeyAction(input: unknown): Promise<ActionResult<ApiKeyView>> {
  return runAction("revokeApiKey", async () => {
    const parsed = revokeApiKeySchema.safeParse(input);
    if (!parsed.success) return actionError("Choose a key to revoke.");
    const admin = await requireAdmin();
    const key = await revokeApiKey(tenantContext(admin), parsed.data.id);
    revalidatePath(SETTINGS_PATH);
    expireTenantReads(admin.companyId);
    return actionOk(key);
  });
}

export async function createWebhookAction(input: unknown): Promise<ActionResult<CreatedWebhook>> {
  return runAction("createWebhook", async () => {
    const parsed = createWebhookSchema.safeParse(input);
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const admin = await requireAdmin();
    await requireRecentAuth();
    const created = await createWebhook(tenantContext(admin), parsed.data);
    revalidatePath(SETTINGS_PATH);
    expireTenantReads(admin.companyId);
    return actionOk(created);
  });
}

export async function setWebhookEnabledAction(input: unknown): Promise<ActionResult<WebhookEndpointView>> {
  return runAction("setWebhookEnabled", async () => {
    const parsed = setWebhookEnabledSchema.safeParse(input);
    if (!parsed.success) return actionError("Choose whether to pause or resume the endpoint.");
    const admin = await requireAdmin();
    const endpoint = await setWebhookEnabled(tenantContext(admin), parsed.data);
    revalidatePath(SETTINGS_PATH);
    expireTenantReads(admin.companyId);
    // Resuming releases whatever queued while it was paused.
    if (endpoint.enabled) scheduleWebhookDrain();
    return actionOk(endpoint);
  });
}

export async function deleteWebhookAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction("deleteWebhook", async () => {
    const parsed = webhookIdSchema.safeParse(input);
    if (!parsed.success) return actionError("Choose an endpoint to remove.");
    const admin = await requireAdmin();
    const deleted = await deleteWebhook(tenantContext(admin), parsed.data.id);
    revalidatePath(SETTINGS_PATH);
    expireTenantReads(admin.companyId);
    return actionOk(deleted);
  });
}

export async function sendTestWebhookAction(input: unknown): Promise<ActionResult<WebhookEndpointView>> {
  return runAction("sendTestWebhook", async () => {
    const parsed = webhookIdSchema.safeParse(input);
    if (!parsed.success) return actionError("Choose an endpoint to test.");
    const admin = await requireAdmin();
    const endpoint = await sendTestWebhook(tenantContext(admin), parsed.data.id);
    revalidatePath(SETTINGS_PATH);
    expireTenantReads(admin.companyId);
    scheduleWebhookDrain();
    return actionOk(endpoint);
  });
}
