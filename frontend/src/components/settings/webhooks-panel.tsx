"use client";

import { Send, Trash2, Webhook } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/mfa/confirm-dialog";
import { CopyValue } from "@/components/settings/copy-value";
import { FormField } from "@/components/shared/form-field";
import { useActionForm } from "@/components/shared/use-action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatRelative } from "@/lib/format";
import {
  createWebhookAction,
  deleteWebhookAction,
  sendTestWebhookAction,
  setWebhookEnabledAction,
} from "@/server/actions/integrations";
import type { WebhookDeliveryView, WebhookEndpointView } from "@/server/queries/integrations";
import { createWebhookSchema, WEBHOOK_EVENTS, type WebhookEvent } from "@resumerank/core/validators/api";

const EVENT_LABELS: Record<WebhookEvent, string> = {
  "application.created": "A candidate is added to a job",
  "application.stage_changed": "An application moves stage",
  "application.scored": "AI scoring finishes",
};

const DELIVERY_STATUS: Record<WebhookDeliveryView["status"], { label: string; className: string }> = {
  PENDING: { label: "Pending", className: "text-verdict-partial" },
  DELIVERED: { label: "Delivered", className: "text-verdict-strong" },
  FAILED: { label: "Failed", className: "text-verdict-missing" },
};

function CreateWebhookForm({ onCreated }: { onCreated: (endpoint: WebhookEndpointView, secret: string) => void }) {
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<WebhookEvent[]>([...WEBHOOK_EVENTS]);
  const { fieldErrors, isPending, submit } = useActionForm({
    schema: createWebhookSchema,
    action: createWebhookAction,
    onSuccess: ({ endpoint, signingSecret }) => {
      setUrl("");
      onCreated(endpoint, signingSecret);
    },
    onError: (message) => toast.error(message),
  });

  function toggle(event: WebhookEvent, checked: boolean) {
    setEvents((current) => (checked ? [...current, event] : current.filter((e) => e !== event)));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit({ url: url.trim(), events });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <FormField label="Endpoint URL" htmlFor="webhook-url" errors={fieldErrors.url} hint="A public https address" required>
        <Input
          id="webhook-url"
          type="url"
          inputMode="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://example.com/resumerank/webhooks"
        />
      </FormField>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium text-foreground">Events</legend>
        {WEBHOOK_EVENTS.map((event) => (
          <Label key={event} className="flex min-h-11 cursor-pointer items-center gap-3 font-normal">
            <Checkbox checked={events.includes(event)} onCheckedChange={(checked) => toggle(event, checked === true)} />
            <span className="flex flex-col">
              <span className="text-sm text-foreground">{EVENT_LABELS[event]}</span>
              <span className="font-mono text-xs text-muted-foreground">{event}</span>
            </span>
          </Label>
        ))}
        {fieldErrors.events ? <p className="text-sm text-destructive">{fieldErrors.events[0]}</p> : null}
      </fieldset>
      <Button type="submit" className="w-fit rounded-full" disabled={isPending}>
        {isPending ? "Adding…" : "Add endpoint"}
      </Button>
    </form>
  );
}

function EndpointCard({
  endpoint,
  onChange,
  onDeleted,
}: {
  endpoint: WebhookEndpointView;
  onChange: (endpoint: WebhookEndpointView) => void;
  onDeleted: (id: string) => void;
}) {
  const [isPending, startTransition] = useTransition();

  function setEnabled(enabled: boolean) {
    startTransition(async () => {
      const result = await setWebhookEnabledAction({ id: endpoint.id, enabled });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onChange(result.data);
      toast.success(enabled ? "Endpoint resumed. Queued events are on their way." : "Endpoint paused. Events queue until you resume it.");
    });
  }

  function sendTest() {
    startTransition(async () => {
      const result = await sendTestWebhookAction({ id: endpoint.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onChange(result.data);
      toast.success("Test event queued. Reload in a few seconds to see how it went.");
    });
  }

  async function remove(): Promise<boolean> {
    const result = await deleteWebhookAction({ id: endpoint.id });
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    onDeleted(endpoint.id);
    toast.success("Endpoint removed.");
    return true;
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <code className="break-all font-mono text-sm text-foreground">{endpoint.url}</code>
          <div className="flex flex-wrap gap-1">
            {endpoint.events.map((event) => (
              <Badge key={event} variant="outline" className="font-mono text-xs">
                {event}
              </Badge>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            {endpoint.lastError
              ? `Last attempt failed: ${endpoint.lastError}`
              : endpoint.lastDeliveredAt
                ? `Last delivered ${formatRelative(endpoint.lastDeliveredAt)}.`
                : "Nothing delivered yet."}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Label className="flex min-h-11 items-center gap-2 pr-2 text-sm font-normal">
            <Switch checked={endpoint.enabled} disabled={isPending} onCheckedChange={setEnabled} />
            {endpoint.enabled ? "Active" : "Paused"}
          </Label>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11"
            disabled={isPending || !endpoint.enabled}
            onClick={sendTest}
            aria-label="Send a test event"
          >
            <Send aria-hidden="true" />
          </Button>
          <ConfirmDialog
            trigger={
              <Button type="button" variant="ghost" size="icon" className="size-11" aria-label="Remove endpoint">
                <Trash2 aria-hidden="true" />
              </Button>
            }
            title="Remove this endpoint?"
            description="It stops receiving events, and anything still queued for it is dropped."
            confirmLabel="Remove endpoint"
            pendingLabel="Removing…"
            onConfirm={remove}
          />
        </div>
      </div>
      {endpoint.recentDeliveries.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border border-t border-border" aria-label="Recent deliveries">
          {endpoint.recentDeliveries.map((delivery) => {
            const status = DELIVERY_STATUS[delivery.status];
            return (
              <li key={delivery.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-xs">
                <span className="font-mono text-foreground">{delivery.event}</span>
                <span className={`font-mono ${status.className}`}>{status.label}</span>
                <span className="font-mono text-muted-foreground">
                  {delivery.attempts} attempt{delivery.attempts === 1 ? "" : "s"}
                </span>
                <span className="text-muted-foreground">{formatRelative(delivery.createdAt)}</span>
                {delivery.lastError && delivery.status !== "DELIVERED" ? (
                  <span className="w-full break-words text-muted-foreground">{delivery.lastError}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

export function WebhooksPanel({ initialEndpoints }: { initialEndpoints: WebhookEndpointView[] }) {
  const [endpoints, setEndpoints] = useState(initialEndpoints);
  const [newSecret, setNewSecret] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Webhooks</CardTitle>
        <CardDescription>
          ResumeRank POSTs a signed JSON event to each endpoint when something happens. Verify the{" "}
          <code className="font-mono text-xs">ResumeRank-Signature</code> header with the endpoint&apos;s
          signing secret, and dedupe on the event <code className="font-mono text-xs">id</code>: failed
          deliveries are retried for about four hours.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {newSecret ? (
          <div className="flex flex-col gap-3 rounded-2xl border border-border bg-muted/30 p-4" role="status">
            <p className="text-sm font-medium text-foreground">
              Copy the signing secret now. It won&apos;t be shown again.
            </p>
            <CopyValue label="Signing secret" value={newSecret} />
            <Button type="button" variant="outline" className="w-fit rounded-full" onClick={() => setNewSecret(null)}>
              I&apos;ve saved it
            </Button>
          </div>
        ) : (
          <CreateWebhookForm
            onCreated={(endpoint, secret) => {
              setEndpoints((current) => [...current, endpoint]);
              setNewSecret(secret);
            }}
          />
        )}

        {endpoints.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border p-8 text-center">
            <Webhook className="size-6 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">No endpoints yet. Add one above to start receiving events.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {endpoints.map((endpoint) => (
              <EndpointCard
                key={endpoint.id}
                endpoint={endpoint}
                onChange={(next) => setEndpoints((current) => current.map((row) => (row.id === next.id ? next : row)))}
                onDeleted={(id) => setEndpoints((current) => current.filter((row) => row.id !== id))}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
