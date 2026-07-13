"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { deleteCandidateAction } from "@/server/actions/candidates";

export function DeleteCandidateDialog({
  candidateId,
  candidateName,
  applicationCount,
}: {
  candidateId: string;
  candidateName: string;
  applicationCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteCandidateAction(candidateId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setOpen(false);
      toast.success(`Deleted ${candidateName}.`);
      router.push("/candidates");
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          <Trash2 aria-hidden="true" />
          Delete
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {candidateName}?</DialogTitle>
          <DialogDescription>
            {applicationCount > 0
              ? `This also permanently deletes their ${applicationCount} application${
                  applicationCount === 1 ? "" : "s"
                }, including any scores, evaluations, and scorecards. This can't be undone.`
              : "This can't be undone."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={handleDelete} disabled={isPending}>
            {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            {isPending ? "Deleting…" : "Delete candidate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
