"use client";

import { Loader2, Network, Plus, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { FeatureUnavailable } from "@/components/settings/feature-unavailable";
import { FormField } from "@/components/shared/form-field";
import { useActionForm } from "@/components/shared/use-action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { addIpRangeAction, removeIpRangeAction } from "@/server/actions/ip-allowlist";
import type { IpAllowlistPanel, IpRange } from "@/server/queries/ip-allowlist";
import { ipAllowed } from "@resumerank/core/auth/ip-allowlist";
import { addIpRangeSchema } from "@resumerank/core/validators/ip-allowlist";

function RangeRow({
  range,
  canRemove,
  onRemoved,
}: {
  range: IpRange;
  canRemove: boolean;
  onRemoved: (id: string) => void;
}) {
  const [isPending, startTransition] = useTransition();

  function remove() {
    startTransition(async () => {
      const result = await removeIpRangeAction({ rangeId: range.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onRemoved(range.id);
      toast.success(`Stopped allowing ${range.cidr}.`);
    });
  }

  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <div className="flex min-w-0 flex-col">
        <span className="font-mono text-sm text-foreground">{range.cidr}</span>
        {range.label ? <span className="truncate text-sm text-muted-foreground">{range.label}</span> : null}
      </div>
      {canRemove ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11 shrink-0"
          disabled={isPending}
          aria-label={`Remove ${range.cidr}`}
          onClick={remove}
        >
          {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
        </Button>
      ) : null}
    </li>
  );
}

function CurrentAddress({ clientIp, covered, listed }: { clientIp: string | null; covered: boolean; listed: boolean }) {
  if (clientIp === null) {
    return (
      <p className="text-sm text-muted-foreground">
        We can&apos;t determine your IP address from here, so it can&apos;t match any range. Check how
        the app is deployed (TRUSTED_IP_HEADER) before turning this on.
      </p>
    );
  }
  return (
    <p className="text-sm text-muted-foreground">
      You&apos;re connecting from <span className="font-mono text-foreground">{clientIp}</span>
      {!listed
        ? "."
        : covered
          ? ", which the list allows."
          : ". The list doesn't cover it: owners keep access, but admins and members here are blocked."}
    </p>
  );
}

export function IpAllowlistCard({ panel }: { panel: IpAllowlistPanel }) {
  const [ranges, setRanges] = useState(panel.ranges);
  const [cidr, setCidr] = useState("");
  const [label, setLabel] = useState("");
  const { fieldErrors, formError, isPending, submit } = useActionForm({
    schema: addIpRangeSchema,
    action: addIpRangeAction,
    onSuccess: (added) => {
      setRanges((current) => [...current, added]);
      setCidr("");
      setLabel("");
      toast.success(
        ranges.length === 0 ? `IP allowlisting is on. Only ${added.cidr} is allowed so far.` : `Allowed ${added.cidr}.`,
      );
    },
  });

  const listed = ranges.length > 0;
  const covered =
    panel.clientIp !== null &&
    ipAllowed(
      panel.clientIp,
      ranges.map((range) => range.cidr),
    );
  const canAdd = panel.canChange && panel.entitled;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit({ cidr, label });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>IP allowlist</CardTitle>
          <Badge variant="outline" className="font-mono">
            {listed ? `On · ${ranges.length} range${ranges.length === 1 ? "" : "s"}` : "Off"}
          </Badge>
        </div>
        <CardDescription>
          Only these networks may use the workspace or its API keys. With no ranges, any network can.
          Owners are exempt in the app (not with API keys) so a wrong range can&apos;t lock the
          company out. Directory sync isn&apos;t affected.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!panel.entitled ? (
          <FeatureUnavailable
            feature="IP allowlisting"
            upgradable={panel.upgradable}
            consequence={listed ? "The ranges below still apply, and owners can remove them." : undefined}
          />
        ) : null}

        <CurrentAddress clientIp={panel.clientIp} covered={covered} listed={listed} />

        {listed ? (
          <ul className="flex flex-col divide-y divide-border rounded-2xl border border-border px-4">
            {ranges.map((range) => (
              <RangeRow
                key={range.id}
                range={range}
                canRemove={panel.canChange}
                onRemoved={(id) => setRanges((current) => current.filter((item) => item.id !== id))}
              />
            ))}
          </ul>
        ) : (
          <div className="flex items-center gap-3 rounded-2xl border border-dashed border-border p-4">
            <Network className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              No ranges yet, so every network is allowed.
              {canAdd ? " Adding the first one turns the allowlist on." : null}
            </p>
          </div>
        )}

        {canAdd ? (
          <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-start" noValidate>
            <FormField
              label="IP address or range"
              htmlFor="ip-range"
              errors={fieldErrors.cidr ?? (formError && !fieldErrors.label ? [formError] : undefined)}
              className="flex-1"
            >
              <Input
                id="ip-range"
                name="cidr"
                placeholder={panel.clientIp ?? "203.0.113.0/24"}
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
                value={cidr}
                onChange={(event) => setCidr(event.target.value)}
              />
            </FormField>
            <FormField label="Label (optional)" htmlFor="ip-range-label" errors={fieldErrors.label} className="flex-1">
              <Input
                id="ip-range-label"
                name="label"
                placeholder="Office VPN"
                autoComplete="off"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
              />
            </FormField>
            <Button type="submit" variant="outline" disabled={isPending} className="sm:mt-6">
              {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Plus aria-hidden="true" />}
              Allow
            </Button>
          </form>
        ) : !panel.canChange ? (
          <p className="text-sm text-muted-foreground">Only workspace owners can change the allowlist.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
