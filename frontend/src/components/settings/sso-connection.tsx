"use client";

import { Loader2, PlugZap, Unplug } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { CopyValue } from "@/components/settings/copy-value";
import { FormField } from "@/components/shared/form-field";
import { useActionForm } from "@/components/shared/use-action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/format";
import { saveSsoConnectionSchema } from "@resumerank/core/validators/sso";
import { removeSsoConnectionAction, saveSsoConnectionAction } from "@/server/actions/sso";
import type { SsoConnectionSummary, SsoSettings } from "@/server/queries/sso";

type Protocol = "saml" | "oidc";

function ConnectionSummary({
  connection,
  enforced,
  onRemoved,
}: {
  connection: SsoConnectionSummary;
  enforced: boolean;
  onRemoved: () => void;
}) {
  const [isPending, startTransition] = useTransition();

  function remove() {
    startTransition(async () => {
      const result = await removeSsoConnectionAction();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onRemoved();
      toast.success("SSO connection removed.");
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <PlugZap className="size-4 text-accent-foreground" aria-hidden="true" />
          <span className="text-sm font-medium text-foreground">{connection.provider}</span>
          <Badge variant="outline" className="font-mono uppercase">
            {connection.type}
          </Badge>
        </div>
        <Button
          type="button"
          variant="ghost"
          disabled={isPending || enforced}
          onClick={remove}
          title={enforced ? "Turn off required SSO first" : undefined}
        >
          {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Unplug aria-hidden="true" />}
          Disconnect
        </Button>
      </div>
      <p className="break-all font-mono text-xs text-muted-foreground">{connection.identifier}</p>
      {connection.certificateExpiresAt ? (
        <p className="text-xs text-muted-foreground">
          Signing certificate expires {formatDate(new Date(connection.certificateExpiresAt))}. Upload
          fresh metadata before then.
        </p>
      ) : null}
    </div>
  );
}

function ConnectionForm({ onSaved }: { onSaved: (connection: SsoConnectionSummary) => void }) {
  const [protocol, setProtocol] = useState<Protocol>("saml");
  const [metadataXml, setMetadataXml] = useState("");
  const [discoveryUrl, setDiscoveryUrl] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const { fieldErrors, formError, isPending, submit } = useActionForm({
    schema: saveSsoConnectionSchema,
    action: saveSsoConnectionAction,
    onSuccess: (connection) => {
      setMetadataXml("");
      setClientSecret("");
      onSaved(connection);
      toast.success(`Connected ${connection.provider}.`);
    },
  });

  function handleSubmit(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    submit(
      protocol === "saml"
        ? { type: "saml", metadataXml }
        : { type: "oidc", discoveryUrl, clientId, clientSecret },
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <Tabs value={protocol} onValueChange={(value) => setProtocol(value === "oidc" ? "oidc" : "saml")}>
        <TabsList>
          <TabsTrigger value="saml">SAML 2.0</TabsTrigger>
          <TabsTrigger value="oidc">OpenID Connect</TabsTrigger>
        </TabsList>
      </Tabs>

      {formError ? <p className="text-sm text-destructive" role="alert">{formError}</p> : null}

      {protocol === "saml" ? (
        <FormField
          label="Identity provider metadata (XML)"
          htmlFor="sso-metadata"
          hint="Okta, Microsoft Entra ID, Google Workspace and OneLogin all offer a metadata download."
          errors={fieldErrors.metadataXml}
        >
          <Textarea
            id="sso-metadata"
            rows={6}
            spellCheck={false}
            className="font-mono text-xs"
            placeholder={'<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" …'}
            value={metadataXml}
            onChange={(event) => setMetadataXml(event.target.value)}
          />
        </FormField>
      ) : (
        <div className="flex flex-col gap-4">
          <FormField label="Discovery URL" htmlFor="sso-discovery" errors={fieldErrors.discoveryUrl}>
            <Input
              id="sso-discovery"
              inputMode="url"
              spellCheck={false}
              placeholder="https://login.acme.com/.well-known/openid-configuration"
              value={discoveryUrl}
              onChange={(event) => setDiscoveryUrl(event.target.value)}
            />
          </FormField>
          <FormField label="Client ID" htmlFor="sso-client-id" errors={fieldErrors.clientId}>
            <Input
              id="sso-client-id"
              autoComplete="off"
              spellCheck={false}
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
            />
          </FormField>
          <FormField label="Client secret" htmlFor="sso-client-secret" errors={fieldErrors.clientSecret}>
            <Input
              id="sso-client-secret"
              type="password"
              autoComplete="off"
              value={clientSecret}
              onChange={(event) => setClientSecret(event.target.value)}
            />
          </FormField>
        </div>
      )}

      <Button type="submit" disabled={isPending} className="w-fit">
        {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <PlugZap aria-hidden="true" />}
        Save connection
      </Button>
    </form>
  );
}

export function SsoConnection({
  initialConnection,
  enforced,
  serviceProvider,
}: {
  initialConnection: SsoConnectionSummary | null;
  enforced: boolean;
  serviceProvider: SsoSettings["serviceProvider"];
}) {
  const [connection, setConnection] = useState(initialConnection);
  const [replacing, setReplacing] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-3 md:grid-cols-2">
        <CopyValue label="ACS URL (SAML)" value={serviceProvider.acsUrl} />
        <CopyValue label="Entity ID / audience" value={serviceProvider.entityId} />
        <CopyValue label="Redirect URI (OIDC)" value={serviceProvider.oidcRedirectUrl} />
      </div>

      {connection && !replacing ? (
        <div className="flex flex-col gap-3">
          <ConnectionSummary
            connection={connection}
            enforced={enforced}
            onRemoved={() => setConnection(null)}
          />
          <Button type="button" variant="outline" className="w-fit" onClick={() => setReplacing(true)}>
            Replace connection
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <ConnectionForm
            onSaved={(saved) => {
              setConnection(saved);
              setReplacing(false);
            }}
          />
          {replacing ? (
            <Button type="button" variant="ghost" className="w-fit" onClick={() => setReplacing(false)}>
              Keep the current connection
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
