"use client";

import { Globe, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { CopyValue } from "@/components/settings/copy-value";
import { FormField } from "@/components/shared/form-field";
import { useActionForm } from "@/components/shared/use-action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { addDomainSchema } from "@resumerank/core/validators/sso";
import {
  addSsoDomainAction,
  removeSsoDomainAction,
  setSsoDomainAutoJoinAction,
  verifySsoDomainAction,
} from "@/server/actions/sso";
import type { SsoDomain } from "@/server/queries/sso";
import type { ActionResult } from "@resumerank/core/types/action";

function DomainStatus({ verified }: { verified: boolean }) {
  return verified ? (
    <Badge className="border-verdict-strong/30 bg-verdict-strong/10 text-verdict-strong">Verified</Badge>
  ) : (
    <Badge className="border-verdict-partial/30 bg-verdict-partial/10 text-verdict-partial">
      Awaiting DNS
    </Badge>
  );
}

function DomainRow({
  domain,
  onChange,
  onRemoved,
}: {
  domain: SsoDomain;
  onChange: (domain: SsoDomain) => void;
  onRemoved: (id: string) => void;
}) {
  const [pending, setPending] = useState<"verify" | "autoJoin" | "remove" | null>(null);
  const [, startTransition] = useTransition();
  const verified = domain.verifiedAt !== null;

  function run<T>(
    kind: "verify" | "autoJoin" | "remove",
    action: () => Promise<ActionResult<T>>,
    done: (data: T) => void,
  ) {
    setPending(kind);
    startTransition(async () => {
      const result = await action();
      setPending(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      done(result.data);
    });
  }

  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Globe className="size-4 text-muted-foreground" aria-hidden="true" />
          <span className="font-mono text-sm text-foreground">{domain.domain}</span>
          <DomainStatus verified={verified} />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11"
          disabled={pending !== null}
          aria-label={`Remove ${domain.domain}`}
          onClick={() =>
            run("remove", () => removeSsoDomainAction({ domainId: domain.id }), () => {
              onRemoved(domain.id);
              toast.success(`Removed ${domain.domain}.`);
            })
          }
        >
          {pending === "remove" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
        </Button>
      </div>

      {verified ? (
        <div className="flex items-center justify-between gap-6">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-foreground">Join automatically</p>
            <p className="text-sm text-muted-foreground">
              People who sign in through your SSO with an @{domain.domain} address join as members
              without an invite.
            </p>
          </div>
          <Switch
            checked={domain.autoJoin}
            disabled={pending !== null}
            aria-label={`Auto-join for ${domain.domain}`}
            onCheckedChange={(autoJoin) =>
              run("autoJoin", () => setSsoDomainAutoJoinAction({ domainId: domain.id, autoJoin }), (updated) => {
                onChange(updated);
                toast.success(autoJoin ? "Auto-join on." : "Auto-join off.");
              })
            }
          />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Add this TXT record at your DNS provider, then check it. Records usually appear within a
            few minutes.
          </p>
          <CopyValue label="Host" value={domain.recordName} />
          <CopyValue label="Value" value={domain.recordValue} />
          <Button
            type="button"
            variant="outline"
            className="w-fit"
            disabled={pending !== null}
            onClick={() =>
              run("verify", () => verifySsoDomainAction({ domainId: domain.id }), (updated) => {
                onChange(updated);
                toast.success(`${updated.domain} is verified.`);
              })
            }
          >
            {pending === "verify" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
            Check DNS record
          </Button>
        </div>
      )}
    </li>
  );
}

export function SsoDomains({ initialDomains }: { initialDomains: SsoDomain[] }) {
  const [domains, setDomains] = useState(initialDomains);
  const [domainName, setDomainName] = useState("");
  const { fieldErrors, formError, isPending, submit } = useActionForm({
    schema: addDomainSchema,
    action: addSsoDomainAction,
    onSuccess: (added) => {
      setDomains((current) => [...current, added]);
      setDomainName("");
      toast.success(`Added ${added.domain}. Publish its TXT record to verify it.`);
    },
  });

  function handleSubmit(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    submit({ domain: domainName });
  }

  function replace(updated: SsoDomain) {
    setDomains((current) => current.map((domain) => (domain.id === updated.id ? updated : domain)));
  }

  return (
    <div className="flex flex-col gap-4">
      {domains.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {domains.map((domain) => (
            <DomainRow
              key={domain.id}
              domain={domain}
              onChange={replace}
              onRemoved={(id) => setDomains((current) => current.filter((item) => item.id !== id))}
            />
          ))}
        </ul>
      ) : (
        <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
          No domains yet. Add the domain your team&apos;s email addresses use — SSO sign-in finds your
          workspace through it.
        </p>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-start" noValidate>
        <FormField
          label="Email domain"
          htmlFor="sso-domain"
          errors={fieldErrors.domain ?? (formError ? [formError] : undefined)}
          className="flex-1"
        >
          <Input
            id="sso-domain"
            name="domain"
            placeholder="acme.com"
            autoComplete="off"
            spellCheck={false}
            value={domainName}
            onChange={(event) => setDomainName(event.target.value)}
          />
        </FormField>
        <Button type="submit" variant="outline" disabled={isPending} className="sm:mt-6">
          {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Plus aria-hidden="true" />}
          Add domain
        </Button>
      </form>
    </div>
  );
}
