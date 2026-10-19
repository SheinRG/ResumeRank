"use client";

import { KeyRound, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { type Formatters } from "@/lib/format";
import { useFormat } from "@/components/format/format-provider";
import { createApiKeyAction, revokeApiKeyAction } from "@/server/actions/integrations";
import type { ApiKeyView } from "@/server/queries/integrations";
import { API_SCOPES, createApiKeySchema, type ApiScope } from "@resumerank/core/validators/api";

const SCOPE_LABELS: Record<ApiScope, string> = {
  "jobs:read": "Read jobs",
  "candidates:read": "Read candidates",
  "candidates:write": "Add candidates",
  "applications:read": "Read applications and scores",
  "applications:write": "Add applications, move stages",
  "scoring:write": "Request AI scoring",
};

const LIFETIMES = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
  { value: "never", label: "No expiry" },
] as const;

type Lifetime = (typeof LIFETIMES)[number]["value"];

function isLifetime(value: string): value is Lifetime {
  return LIFETIMES.some((option) => option.value === value);
}

function expiresInDays(lifetime: Lifetime): 30 | 90 | 365 | null {
  if (lifetime === "never") return null;
  return lifetime === "30" ? 30 : lifetime === "90" ? 90 : 365;
}

function keyStatus(key: ApiKeyView, format: Formatters): { label: string; live: boolean } {
  if (key.revokedAt) return { label: "Revoked", live: false };
  if (key.expiresAt && new Date(key.expiresAt) <= new Date()) return { label: "Expired", live: false };
  return { label: key.expiresAt ? `Expires ${format.date(key.expiresAt)}` : "No expiry", live: true };
}

function CreateKeyForm({ onCreated }: { onCreated: (key: ApiKeyView, token: string) => void }) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ApiScope[]>(["jobs:read", "candidates:read", "applications:read"]);
  const [lifetime, setLifetime] = useState<Lifetime>("90");
  const { fieldErrors, isPending, submit } = useActionForm({
    schema: createApiKeySchema,
    action: createApiKeyAction,
    onSuccess: ({ key, token }) => {
      setName("");
      onCreated(key, token);
    },
    onError: (message) => toast.error(message),
  });

  function toggle(scope: ApiScope, checked: boolean) {
    setScopes((current) => (checked ? [...current, scope] : current.filter((s) => s !== scope)));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit({ name: name.trim(), scopes, expiresInDays: expiresInDays(lifetime) });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
        <FormField label="Name" htmlFor="api-key-name" errors={fieldErrors.name} hint="Where it's used, e.g. HRIS sync" required>
          <Input id="api-key-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={60} />
        </FormField>
        <FormField label="Expires" htmlFor="api-key-lifetime" errors={fieldErrors.expiresInDays}>
          <Select value={lifetime} onValueChange={(value) => isLifetime(value) && setLifetime(value)}>
            <SelectTrigger id="api-key-lifetime" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LIFETIMES.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium text-foreground">Permissions</legend>
        <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {API_SCOPES.map((scope) => (
            <Label key={scope} className="flex min-h-11 cursor-pointer items-center gap-3 font-normal">
              <Checkbox
                checked={scopes.includes(scope)}
                onCheckedChange={(checked) => toggle(scope, checked === true)}
              />
              <span className="flex flex-col">
                <span className="text-sm text-foreground">{SCOPE_LABELS[scope]}</span>
                <span className="font-mono text-xs text-muted-foreground">{scope}</span>
              </span>
            </Label>
          ))}
        </div>
        {fieldErrors.scopes ? (
          <p className="text-sm text-destructive">{fieldErrors.scopes[0]}</p>
        ) : null}
      </fieldset>
      <p className="text-sm text-muted-foreground">
        The key acts as you: it can never do more than your role allows, and it stops working if you
        leave the workspace.
      </p>
      <Button type="submit" className="w-fit rounded-full" disabled={isPending}>
        {isPending ? "Creating…" : "Create key"}
      </Button>
    </form>
  );
}

export function ApiKeysPanel({ initialKeys }: { initialKeys: ApiKeyView[] }) {
  const format = useFormat();
  const [keys, setKeys] = useState(initialKeys);
  const [newToken, setNewToken] = useState<string | null>(null);

  async function revoke(key: ApiKeyView): Promise<boolean> {
    const result = await revokeApiKeyAction({ id: key.id });
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    setKeys((current) => current.map((row) => (row.id === key.id ? result.data : row)));
    toast.success(`Revoked "${key.name}". Requests using it now fail.`);
    return true;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>API keys</CardTitle>
        <CardDescription>
          For integrations that call the ResumeRank REST API. Send the key as{" "}
          <code className="font-mono text-xs">Authorization: Bearer &lt;key&gt;</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {newToken ? (
          <div className="flex flex-col gap-3 rounded-2xl border border-border bg-muted/30 p-4" role="status">
            <p className="text-sm font-medium text-foreground">
              Copy this key now. It won&apos;t be shown again.
            </p>
            <CopyValue label="API key" value={newToken} />
            <Button type="button" variant="outline" className="w-fit rounded-full" onClick={() => setNewToken(null)}>
              I&apos;ve saved it
            </Button>
          </div>
        ) : (
          <CreateKeyForm
            onCreated={(key, token) => {
              setKeys((current) => [key, ...current]);
              setNewToken(token);
            }}
          />
        )}

        {keys.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border p-8 text-center">
            <KeyRound className="size-6 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">No API keys yet. Create one above to connect an integration.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Permissions</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-14">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((key) => {
                const status = keyStatus(key, format);
                return (
                  <TableRow key={key.id} className={status.live ? undefined : "text-muted-foreground"}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">{key.name}</span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {key.prefix}… · by {key.createdBy.name}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex max-w-xs flex-wrap gap-1">
                        {key.scopes.map((scope) => (
                          <Badge key={scope} variant="outline" className="font-mono text-xs">
                            {scope}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {key.lastUsedAt ? format.relative(key.lastUsedAt) : "Never"}
                    </TableCell>
                    <TableCell className="text-sm">{status.label}</TableCell>
                    <TableCell className="text-right">
                      {status.live ? (
                        <ConfirmDialog
                          trigger={
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-11"
                              aria-label={`Revoke ${key.name}`}
                            >
                              <Trash2 aria-hidden="true" />
                            </Button>
                          }
                          title={`Revoke "${key.name}"?`}
                          description="Every request using this key fails from now on. Integrations using it stop until you give them a new key."
                          confirmLabel="Revoke key"
                          pendingLabel="Revoking…"
                          onConfirm={() => revoke(key)}
                        />
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
