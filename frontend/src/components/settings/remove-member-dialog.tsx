"use client";

import { Loader2, UserMinus } from "lucide-react";
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
import { removeMemberAction } from "@/server/actions/users";

export function RemoveMemberDialog({
  userId,
  memberName,
  onRemoved,
}: {
  userId: string;
  memberName: string;
  onRemoved: (userId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleRemove() {
    startTransition(async () => {
      const result = await removeMemberAction({ userId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setOpen(false);
      onRemoved(userId);
      toast.success(`Removed ${result.data.name} from the workspace.`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11"
          aria-label={`Remove ${memberName}`}
        >
          <UserMinus aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {memberName}?</DialogTitle>
          <DialogDescription>
            They lose access to this workspace immediately. Jobs, candidates
            and activity they created stay with the company. You can invite
            them again later.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleRemove}
            disabled={isPending}
          >
            {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            {isPending ? "Removing…" : "Remove member"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
