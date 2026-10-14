import { requireAdmin, tenantContext } from "@/lib/auth/guards";
import * as apiKeys from "@resumerank/core/services/api-keys";
import * as webhooks from "@resumerank/core/services/webhooks";

export type { ApiKeyView } from "@resumerank/core/services/api-keys";
export type { WebhookDeliveryView, WebhookEndpointView } from "@resumerank/core/services/webhooks";

export async function listApiKeys(): Promise<apiKeys.ApiKeyView[]> {
  const admin = await requireAdmin();
  return apiKeys.listApiKeys(tenantContext(admin));
}

export async function listWebhooks(): Promise<webhooks.WebhookEndpointView[]> {
  const admin = await requireAdmin();
  return webhooks.listWebhooks(tenantContext(admin));
}
