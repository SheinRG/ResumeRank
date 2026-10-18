"use client";

import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/mfa/confirm-dialog";
import { FormField } from "@/components/shared/form-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useStepUp } from "@/components/step-up/step-up-provider";
import { setCandidateRetentionAction } from "@/server/actions/compliance";
import { CANDIDATE_RETENTION_DAYS, candidateRetentionSchema } from "@resumerank/core/validators/compliance";

const UNTIL_DELETED = "until-deleted";

function retentionLabel(days: number | null): string {
  if (days === null) return "Until deleted";
  if (days % 365 === 0) return `${days / 365} year${days === 365 ? "" : "s"}`;
  return `${days} days`;
}

function toDays(value: string): number | null {
  return value === UNTIL_DELETED ? null : Number(value);
}

/** A shorter period than now deletes candidates at the next purge, so it is confirmed first. */
function isShorter(next: number | null, current: number | null): boolean {
  if (next === null) return false;
  return current === null || next < current;
}

export function CandidateRetentionCard({ retentionDays, canChange }: { retentionDays: number | null; canChange: boolean }) {
  const [saved, setSaved] = useState(retentionDays);
  const [value, setValue] = useState(retentionDays === null ? UNTIL_DELETED : String(retentionDays));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const withStepUp = useStepUp();
  const days = toDays(value);
  const dirty = days !== saved;

  async function save(): Promise<boolean> {
    const parsed = candidateRetentionSchema.safeParse({ retentionDays: days });
    if (!parsed.success) {
      setError(parsed.error.flatten().fieldErrors.retentionDays?.[0] ?? "Choose one of the listed periods");
      return false;
    }
    setError(null);
    const result = await withStepUp(() => setCandidateRetentionAction(parsed.data));
    if (!result.ok) {
      setError(result.fieldErrors?.retentionDays?.[0] ?? null);
      toast.error(result.error);
      return false;
    }
    setSaved(result.data.retentionDays);
    toast.success(
      result.data.retentionDays === null
        ? "Candidates will be kept until someone deletes them."
        : `Candidates with no activity for ${retentionLabel(result.data.retentionDays).toLowerCase()} will be deleted.`,
    );
    return true;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Candidate retention</CardTitle>
        <CardDescription>
          How long candidates are kept once nothing has happened on them or their applications. When the
          period passes, the candidate is deleted with everything about them: resume, files, scores, ratings
          and self-identification answers. The audit log records how many, never who.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <FormField label="Keep inactive candidates for" htmlFor="candidate-retention" errors={error ? [error] : undefined}>
          <Select value={value} onValueChange={setValue} disabled={!canChange || isPending}>
            <SelectTrigger id="candidate-retention" className="w-full sm:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNTIL_DELETED}>{retentionLabel(null)}</SelectItem>
              {CANDIDATE_RETENTION_DAYS.map((option) => (
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
              title={`Delete candidates inactive for ${retentionLabel(days).toLowerCase()}?`}
              description="Candidates already past this period are deleted permanently at the next scheduled purge, with everything about them. This can't be undone."
              confirmLabel="Save and delete"
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
