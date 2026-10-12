"use client";

import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/mfa/confirm-dialog";
import { FormField } from "@/components/shared/form-field";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { setAuditRetentionAction } from "@/server/actions/audit";
import { AUDIT_RETENTION_DAYS, auditRetentionSchema } from "@resumerank/core/validators/audit";

const FOREVER = "forever";

function retentionLabel(days: number | null): string {
  if (days === null) return "Forever";
  if (days % 365 === 0) return `${days / 365} year${days === 365 ? "" : "s"}`;
  return `${days} days`;
}

function toDays(value: string): number | null {
  return value === FOREVER ? null : Number(value);
}

/** A shorter period than now deletes entries, so it is confirmed first. */
function isShorter(next: number | null, current: number | null): boolean {
  if (next === null) return false;
  return current === null || next < current;
}

export function AuditRetention({
  retentionDays,
  canChange,
}: {
  retentionDays: number | null;
  canChange: boolean;
}) {
  const [saved, setSaved] = useState(retentionDays);
  const [value, setValue] = useState(retentionDays === null ? FOREVER : String(retentionDays));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const days = toDays(value);
  const dirty = days !== saved;

  async function save(): Promise<boolean> {
    const parsed = auditRetentionSchema.safeParse({ retentionDays: days });
    if (!parsed.success) {
      setError(parsed.error.flatten().fieldErrors.retentionDays?.[0] ?? "Choose one of the listed periods");
      return false;
    }
    setError(null);
    const result = await setAuditRetentionAction(parsed.data);
    if (!result.ok) {
      setError(result.fieldErrors?.retentionDays?.[0] ?? null);
      toast.error(result.error);
      return false;
    }
    setSaved(result.data.retentionDays);
    toast.success(
      result.data.retentionDays === null
        ? "Audit entries will be kept forever."
        : `Audit entries older than ${retentionLabel(result.data.retentionDays).toLowerCase()} will be deleted.`,
    );
    return true;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Retention</CardTitle>
        <CardDescription>
          How long entries are kept. Older ones are deleted permanently within a few minutes of the period
          passing, and the deletion itself is recorded in the log. Export anything you need to keep longer
          first.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <FormField label="Keep entries for" htmlFor="audit-retention" errors={error ? [error] : undefined}>
          <Select value={value} onValueChange={setValue} disabled={!canChange || isPending}>
            <SelectTrigger id="audit-retention" className="w-full sm:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={FOREVER}>{retentionLabel(null)}</SelectItem>
              {AUDIT_RETENTION_DAYS.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  {retentionLabel(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        {!canChange ? (
          <p className="text-sm text-muted-foreground">Only an owner can change this.</p>
        ) : isShorter(days, saved) ? (
          <div>
            <ConfirmDialog
              trigger={<Button type="button">Save retention</Button>}
              title={`Delete entries older than ${retentionLabel(days).toLowerCase()}?`}
              description="Anything older is deleted permanently within a few minutes and can't be recovered. Export the log first if you need to keep it."
              confirmLabel="Delete older entries"
              pendingLabel="Saving…"
              onConfirm={save}
            />
          </div>
        ) : (
          <div>
            <Button
              type="button"
              disabled={!dirty || isPending}
              onClick={() => startTransition(async () => void (await save()))}
            >
              {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              {isPending ? "Saving…" : "Save retention"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
