"use client";

import { Loader2 } from "lucide-react";
import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";

import { FormField } from "@/components/shared/form-field";
import { useStepUp } from "@/components/step-up/step-up-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@resumerank/core/types/action";

/**
 * Every staff change says why: the reason goes into the staff audit log, and
 * for support sessions into the workspace's own log too. The action parses
 * it with the shared schema; the dialog only checks it isn't blank.
 */
export function ReasonDialog<T>({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive = false,
  children,
  onConfirm,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  /** Extra fields above the reason. */
  children?: ReactNode;
  onConfirm: (reason: string) => Promise<ActionResult<T>>;
  onDone: (data: T) => void;
}) {
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<string[] | undefined>();
  const [isPending, startTransition] = useTransition();
  const withStepUp = useStepUp();

  function submit() {
    startTransition(async () => {
      const result = await withStepUp(() => onConfirm(reason));
      if (!result.ok) {
        setErrors(result.fieldErrors?.reason);
        if (!result.fieldErrors?.reason) toast.error(result.error);
        return;
      }
      setReason("");
      setErrors(undefined);
      onOpenChange(false);
      onDone(result.data);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !isPending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {children}
          <FormField
            label="Reason"
            hint="At least 10 characters. Add the ticket reference if there is one."
            errors={errors}
            required
          >
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              rows={3}
              aria-invalid={errors ? true : undefined}
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant={destructive ? "destructive" : "default"}
              disabled={isPending || reason.trim().length === 0}
            >
              {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
