import type { Metadata } from "next";

import { ApiKeysPanel } from "@/components/settings/api-keys-panel";
import { WebhooksPanel } from "@/components/settings/webhooks-panel";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { canAdmin, requireMember } from "@/lib/auth/guards";
import { listApiKeys, listWebhooks } from "@/server/queries/integrations";

export const metadata: Metadata = { title: "API · Settings" };

export default async function SettingsApiPage() {
  const user = await requireMember();
  if (!canAdmin(user.role)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>API and webhooks</CardTitle>
          <CardDescription>
            API keys and webhook endpoints are managed by your workspace admins.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const [keys, endpoints] = await Promise.all([listApiKeys(), listWebhooks()]);
  return (
    <div className="flex flex-col gap-6">
      <ApiKeysPanel initialKeys={keys} />
      <WebhooksPanel initialEndpoints={endpoints} />
    </div>
  );
}
