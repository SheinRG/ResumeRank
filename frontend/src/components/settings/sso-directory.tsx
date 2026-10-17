"use client";

import { FolderSync, Loader2, TriangleAlert, Unplug } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { CopyValue } from "@/components/settings/copy-value";
import { FeatureUnavailable } from "@/components/settings/feature-unavailable";
import { FormField } from "@/components/shared/form-field";
import { useActionForm } from "@/components/shared/use-action-form";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createDirectorySchema,
  DIRECTORY_TYPES,
  type CreateDirectoryInput,
} from "@resumerank/core/validators/sso";
import { createDirectoryAction, removeDirectoryAction } from "@/server/actions/sso";
import type { DirectoryCredentials, DirectorySummary } from "@/server/queries/sso";

type DirectoryType = CreateDirectoryInput["type"];

const TYPE_LABELS: Record<DirectoryType, string> = {
  "okta-scim-v2": "Okta",
  "azure-scim-v2": "Microsoft Entra ID",
  "onelogin-scim-v2": "OneLogin",
  "jumpcloud-scim-v2": "JumpCloud",
  "generic-scim-v2": "Other SCIM 2.0 provider",
};

function isDirectoryType(value: string): value is DirectoryType {
  return (DIRECTORY_TYPES as readonly string[]).includes(value);
}

function Connected({
  directory,
  token,
  onRemoved,
}: {
  directory: DirectorySummary;
  token: string | null;
  onRemoved: () => void;
}) {
  const [isPending, startTransition] = useTransition();

  function remove() {
    startTransition(async () => {
      const result = await removeDirectoryAction();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onRemoved();
      toast.success("Directory sync disconnected. Members it added stay in the workspace.");
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border p-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <FolderSync className="size-4 text-muted-foreground" aria-hidden="true" />
            <span className="text-sm font-medium text-foreground">{directory.provider}</span>
          </div>
          <span className="font-mono text-xs text-muted-foreground">
            {directory.managedMembers} member{directory.managedMembers === 1 ? "" : "s"} managed by the directory
          </span>
        </div>
        <Button type="button" variant="ghost" disabled={isPending} onClick={remove}>
          {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Unplug aria-hidden="true" />}
          Disconnect
        </Button>
      </div>

      <CopyValue label="SCIM base URL" value={directory.endpoint} />
      {token ? (
        <div className="flex flex-col gap-2">
          <CopyValue label="Bearer token" value={token} />
          <p className="flex items-start gap-2 rounded-lg border border-verdict-partial/40 bg-verdict-partial/10 p-3 text-sm text-foreground">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-verdict-partial" aria-hidden="true" />
            Copy the token into your identity provider now — it won&apos;t be shown again. To get a new
            one, disconnect and connect again.
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function SsoDirectory({
  initialDirectory,
  entitled,
  upgradable,
}: {
  initialDirectory: DirectorySummary | null;
  entitled: boolean;
  upgradable: boolean;
}) {
  const [directory, setDirectory] = useState<DirectorySummary | null>(initialDirectory);
  const [token, setToken] = useState<string | null>(null);
  const [type, setType] = useState<DirectoryType>("okta-scim-v2");
  const { formError, isPending, submit } = useActionForm({
    schema: createDirectorySchema,
    action: createDirectoryAction,
    onSuccess: ({ token: created, ...summary }: DirectoryCredentials) => {
      setDirectory(summary);
      setToken(created);
      toast.success(`Connected ${summary.provider} directory sync.`);
    },
  });

  if (directory) {
    return (
      <div className="flex flex-col gap-4">
        {entitled ? null : (
          <FeatureUnavailable
            feature="Directory sync"
            upgradable={upgradable}
            consequence="Your identity provider's changes are refused meanwhile; you can still disconnect it."
          />
        )}
        <Connected
          directory={directory}
          token={token}
          onRemoved={() => {
            setDirectory(null);
            setToken(null);
          }}
        />
      </div>
    );
  }
  if (!entitled) return <FeatureUnavailable feature="Directory sync" upgradable={upgradable} />;

  function handleSubmit(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    submit({ type });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-start" noValidate>
      <FormField
        label="Identity provider"
        htmlFor="directory-type"
        errors={formError ? [formError] : undefined}
        className="flex-1"
      >
        <Select value={type} onValueChange={(value) => isDirectoryType(value) && setType(value)}>
          <SelectTrigger id="directory-type" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DIRECTORY_TYPES.map((option) => (
              <SelectItem key={option} value={option}>
                {TYPE_LABELS[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      <Button type="submit" variant="outline" disabled={isPending} className="sm:mt-6">
        {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <FolderSync aria-hidden="true" />}
        Connect directory sync
      </Button>
    </form>
  );
}
