"use client";

import { Loader2, Pause, Play, Radio, Send, TriangleAlert, Unplug } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/mfa/confirm-dialog";
import { CopyValue } from "@/components/settings/copy-value";
import { FeatureUnavailable } from "@/components/settings/feature-unavailable";
import { FormField } from "@/components/shared/form-field";
import { useActionForm } from "@/components/shared/use-action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useStepUp } from "@/components/step-up/step-up-provider";
import { useFormat } from "@/components/format/format-provider";
import {
  removeAuditStreamAction,
  saveAuditStreamAction,
  setAuditStreamEnabledAction,
  testAuditStreamAction,
} from "@/server/actions/audit";
import type { AuditStreamSummary, SavedAuditStream } from "@/server/queries/audit";
import { AUDIT_STREAM_KINDS, auditStreamSchema } from "@resumerank/core/validators/audit";

type StreamKind = (typeof AUDIT_STREAM_KINDS)[number];

const KINDS: Record<StreamKind, { label: string; placeholder: string; hint: string; tokenLabel: string | null }> = {
  WEBHOOK: {
    label: "HTTPS webhook",
    placeholder: "https://siem.example.com/resumerank",
    hint: "Batches of JSON events, POSTed and signed with a secret you get after saving.",
    tokenLabel: null,
  },
  SPLUNK: {
    label: "Splunk (HTTP Event Collector)",
    placeholder: "https://splunk.example.com:8088/services/collector/event",
    hint: "Your HEC endpoint. Events arrive with sourcetype resumerank:audit.",
    tokenLabel: "HEC token",
  },
  DATADOG: {
    label: "Datadog Logs",
    placeholder: "https://http-intake.logs.datadoghq.com/api/v2/logs",
    hint: "Use your site's intake host, e.g. http-intake.logs.datadoghq.eu. Events arrive with source resumerank.",
    tokenLabel: "API key",
  },
};

function isKind(value: string): value is StreamKind {
  return (AUDIT_STREAM_KINDS as readonly string[]).includes(value);
}

function StreamForm({
  current,
  onSaved,
  onCancel,
}: {
  current: AuditStreamSummary | null;
  onSaved: (saved: SavedAuditStream) => void;
  onCancel: (() => void) | null;
}) {
  const [kind, setKind] = useState<StreamKind>(current?.kind ?? "WEBHOOK");
  const [url, setUrl] = useState(current?.url ?? "");
  const [token, setToken] = useState("");
  const { fieldErrors, formError, isPending, submit } = useActionForm({
    schema: auditStreamSchema,
    action: saveAuditStreamAction,
    onSuccess: onSaved,
  });
  const info = KINDS[kind];
  const keepsToken = current?.kind === kind;

  function handleSubmit(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    submit({ kind, url, token: info.tokenLabel && token ? token : undefined });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Destination" htmlFor="audit-stream-kind">
          <Select value={kind} onValueChange={(value) => isKind(value) && setKind(value)}>
            <SelectTrigger id="audit-stream-kind" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AUDIT_STREAM_KINDS.map((option) => (
                <SelectItem key={option} value={option}>
                  {KINDS[option].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        {info.tokenLabel ? (
          <FormField
            label={info.tokenLabel}
            htmlFor="audit-stream-token"
            errors={fieldErrors.token}
            hint={keepsToken ? "Leave blank to keep the saved one" : undefined}
          >
            <Input
              type="password"
              autoComplete="off"
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
          </FormField>
        ) : null}
      </div>
      <FormField label="Endpoint URL" htmlFor="audit-stream-url" errors={fieldErrors.url} hint={info.hint}>
        <Input
          type="url"
          inputMode="url"
          placeholder={info.placeholder}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
      </FormField>
      {formError && !fieldErrors.url && !fieldErrors.token ? (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Radio aria-hidden="true" />}
          {current ? "Save destination" : "Start streaming"}
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={isPending}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function StreamState({ stream }: { stream: AuditStreamSummary }) {
  if (!stream.enabled) return <Badge variant="outline">Paused</Badge>;
  if (stream.failures > 0) {
    return (
      <Badge variant="outline" className="border-destructive/40 text-destructive">
        Failing
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-verdict-strong/40 text-verdict-strong">
      Live
    </Badge>
  );
}

function StreamStatus({ stream }: { stream: AuditStreamSummary }) {
  const format = useFormat();
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-foreground">{KINDS[stream.kind].label}</span>
        <StreamState stream={stream} />
      </div>
      <code className="break-all font-mono text-xs text-muted-foreground">{stream.url}</code>
      <dl className="grid gap-2 font-mono text-xs sm:grid-cols-2">
        <div className="flex gap-2">
          <dt className="text-muted-foreground">Last delivery</dt>
          <dd className="text-foreground" title={stream.lastDeliveredAt ? format.date(stream.lastDeliveredAt) : undefined}>
            {stream.lastDeliveredAt ? format.relative(stream.lastDeliveredAt) : "None yet"}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground">Waiting</dt>
          <dd className="text-foreground">
            {format.number(stream.pending)} {stream.pending === 1 ? "entry" : "entries"}
          </dd>
        </div>
      </dl>
      {stream.enabled && stream.lastError ? (
        <p className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
          <span>
            {stream.lastError} Next retry{" "}
            <time dateTime={new Date(stream.nextAttemptAt).toISOString()}>{format.date(stream.nextAttemptAt)}</time>;
            nothing is skipped meanwhile.
          </span>
        </p>
      ) : null}
    </div>
  );
}

function SigningSecret({ secret }: { secret: string }) {
  return (
    <div className="flex flex-col gap-2">
      <CopyValue label="Signing secret" value={secret} />
      <p className="flex items-start gap-2 rounded-lg border border-verdict-partial/40 bg-verdict-partial/10 p-3 text-sm text-foreground">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-verdict-partial" aria-hidden="true" />
        <span>
          Copy it now — it won&apos;t be shown again. Each request carries a{" "}
          <code className="font-mono text-xs">ResumeRank-Signature: t=…,v1=…</code> header, where v1 is the
          hex HMAC-SHA256 of <code className="font-mono text-xs">{"{t}.{body}"}</code> under this secret.
          Reject requests whose signature doesn&apos;t match or whose t is more than five minutes old.
        </span>
      </p>
    </div>
  );
}

function StreamActions({
  stream,
  entitled,
  onChanged,
  onEdit,
  onRemoved,
}: {
  stream: AuditStreamSummary;
  /** Without it the stream can only be paused or disconnected. */
  entitled: boolean;
  onChanged: (stream: AuditStreamSummary) => void;
  onEdit: () => void;
  onRemoved: () => void;
}) {
  const [pending, setPending] = useState<"test" | "toggle" | null>(null);
  const [, startTransition] = useTransition();
  const withStepUp = useStepUp();

  function sendTest() {
    setPending("test");
    startTransition(async () => {
      const result = await testAuditStreamAction();
      setPending(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Test event delivered. Look for action audit.stream_test in your SIEM.");
    });
  }

  function toggle() {
    setPending("toggle");
    startTransition(async () => {
      const result = await setAuditStreamEnabledAction({ enabled: !stream.enabled });
      setPending(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onChanged(result.data);
      toast.success(result.data.enabled ? "Streaming resumed. It catches up from where it paused." : "Streaming paused.");
    });
  }

  async function remove(): Promise<boolean> {
    const result = await withStepUp(() => removeAuditStreamAction());
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    onRemoved();
    toast.success("Audit streaming disconnected.");
    return true;
  }

  const busy = pending !== null;
  return (
    <div className="flex flex-wrap gap-2">
      {entitled ? (
        <Button type="button" variant="outline" onClick={sendTest} disabled={busy}>
          {pending === "test" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />}
          Send test event
        </Button>
      ) : null}
      {entitled || stream.enabled ? (
        <Button type="button" variant="outline" onClick={toggle} disabled={busy}>
          {pending === "toggle" ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : stream.enabled ? (
            <Pause aria-hidden="true" />
          ) : (
            <Play aria-hidden="true" />
          )}
          {stream.enabled ? "Pause" : "Resume"}
        </Button>
      ) : null}
      {entitled ? (
        <Button type="button" variant="ghost" onClick={onEdit} disabled={busy}>
          Change destination
        </Button>
      ) : null}
      <ConfirmDialog
        trigger={
          <Button type="button" variant="ghost" disabled={busy}>
            <Unplug aria-hidden="true" />
            Disconnect
          </Button>
        }
        title="Stop streaming the audit log?"
        description="New entries stop going to your SIEM. The log itself is untouched; connecting again starts from the newest entry."
        confirmLabel="Disconnect"
        pendingLabel="Disconnecting…"
        onConfirm={remove}
      />
    </div>
  );
}

export function AuditStreamCard({
  initialStream,
  canChange,
  entitled,
  upgradable,
}: {
  initialStream: AuditStreamSummary | null;
  canChange: boolean;
  entitled: boolean;
  upgradable: boolean;
}) {
  const [stream, setStream] = useState(initialStream);
  const [signingSecret, setSigningSecret] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  function handleSaved(saved: SavedAuditStream) {
    setStream(saved.stream);
    setSigningSecret(saved.signingSecret);
    setEditing(false);
    toast.success(
      stream
        ? "Destination saved. Delivery picks up where it left off."
        : `Streaming new entries to ${KINDS[saved.stream.kind].label}.`,
    );
  }

  let body: React.ReactNode;
  if (!stream && !entitled) {
    body = <FeatureUnavailable feature="Audit log streaming" upgradable={upgradable} />;
  } else if (!stream) {
    body = canChange ? (
      <StreamForm current={null} onSaved={handleSaved} onCancel={null} />
    ) : (
      <p className="text-sm text-muted-foreground">Not connected. Only an owner can set this up.</p>
    );
  } else if (editing) {
    body = <StreamForm current={stream} onSaved={handleSaved} onCancel={() => setEditing(false)} />;
  } else {
    body = (
      <>
        {entitled ? null : (
          <FeatureUnavailable
            feature="Audit log streaming"
            upgradable={upgradable}
            consequence="Nothing is sent meanwhile, and delivery catches up from where it stopped once it's back."
          />
        )}
        <StreamStatus stream={stream} />
        {signingSecret ? <SigningSecret secret={signingSecret} /> : null}
        {canChange ? (
          <StreamActions
            stream={stream}
            entitled={entitled}
            onChanged={setStream}
            onEdit={() => {
              setSigningSecret(null);
              setEditing(true);
            }}
            onRemoved={() => {
              setStream(null);
              setSigningSecret(null);
            }}
          />
        ) : (
          <p className="text-sm text-muted-foreground">Only an owner can change this.</p>
        )}
      </>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stream to your SIEM</CardTitle>
        <CardDescription>
          Sends every new entry to Splunk, Datadog or any HTTPS endpoint within about a minute, in order and
          at least once (deduplicate on <code className="font-mono text-xs">id</code>). It starts from the
          newest entry; use an export for history.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{body}</CardContent>
    </Card>
  );
}
