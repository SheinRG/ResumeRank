"use client";

import { FileDown, Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { FormField } from "@/components/shared/form-field";
import { StepUpDownload } from "@/components/step-up/step-up-download";
import { useStepUp } from "@/components/step-up/step-up-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { deleteWorkspaceAction } from "@/server/actions/compliance";
import { deleteWorkspaceSchema } from "@resumerank/core/validators/compliance";

export function WorkspaceOffboarding({ companyName }: { companyName: string }) {
  const [open, setOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [errors, setErrors] = useState<string[] | undefined>();
  const [isPending, startTransition] = useTransition();
  const withStepUp = useStepUp();
  const router = useRouter();

  function remove() {
    const parsed = deleteWorkspaceSchema.safeParse({ confirmName });
    if (!parsed.success) {
      setErrors(parsed.error.flatten().fieldErrors.confirmName);
      return;
    }
    if (parsed.data.confirmName !== companyName.trim()) {
      setErrors([`Type ${companyName} exactly to confirm`]);
      return;
    }
    setErrors(undefined);
    startTransition(async () => {
      const result = await withStepUp(() => deleteWorkspaceAction(parsed.data));
      if (!result.ok) {
        setErrors(result.fieldErrors?.confirmName);
        toast.error(result.error);
        return;
      }
      router.replace("/onboarding");
      router.refresh();
    });
  }

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle>Leave ResumeRank</CardTitle>
        <CardDescription>
          Take everything with you, then delete the workspace. The export is JSON Lines, one record per line:
          jobs, candidates with their resumes, applications, scores with their inputs, ratings, members and the
          full audit log. Resume files are listed; download any originals you need from candidate pages first.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-3">
        <StepUpDownload href="/settings/company/export" icon={<FileDown aria-hidden="true" />}>
          Export all data
        </StepUpDownload>

        <Dialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) {
              setConfirmName("");
              setErrors(undefined);
            }
          }}
        >
          <DialogTrigger asChild>
            <Button type="button" variant="destructive">
              <Trash2 aria-hidden="true" />
              Delete workspace
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Delete {companyName}?</DialogTitle>
              <DialogDescription>
                Everything in the workspace is deleted permanently: jobs, candidates, files, scores, the audit
                log, SSO and API settings. Any paid subscription is cancelled at once. Members keep their
                accounts. This can&apos;t be undone.
              </DialogDescription>
            </DialogHeader>
            <FormField label={`Type ${companyName} to confirm`} htmlFor="delete-workspace-name" errors={errors}>
              <Input
                id="delete-workspace-name"
                autoComplete="off"
                value={confirmName}
                disabled={isPending}
                onChange={(event) => setConfirmName(event.target.value)}
              />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
                Cancel
              </Button>
              <Button type="button" variant="destructive" onClick={remove} disabled={isPending}>
                {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                {isPending ? "Deleting…" : "Delete workspace"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
