"use client";

import { UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createApplicationAction } from "@/server/actions/applications";
import type { CandidateOption } from "@/server/queries/candidates";

export function AddCandidateDialog({
  jobId,
  candidates,
}: {
  jobId: string;
  candidates: CandidateOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [candidateId, setCandidateId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setCandidateId("");
      setError(null);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!candidateId) {
      setError("Pick a candidate.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await createApplicationAction({ jobId, candidateId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("Candidate added to the pipeline.");
      handleOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button">
          <UserPlus aria-hidden="true" />
          Add candidate
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Add candidate</DialogTitle>
            <DialogDescription>
              Attach an existing candidate to this job&apos;s pipeline.
            </DialogDescription>
          </DialogHeader>

          {candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              You don&apos;t have any candidates yet.{" "}
              <Link href="/candidates" className="font-medium text-primary hover:underline">
                Add one first
              </Link>
              .
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="add-candidate-select">Candidate</Label>
              <Select value={candidateId} onValueChange={setCandidateId}>
                <SelectTrigger id="add-candidate-select" className="w-full" aria-invalid={error ? true : undefined}>
                  <SelectValue placeholder="Select a candidate" />
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {candidate.name} · {candidate.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || candidates.length === 0}>
              {pending ? "Adding…" : "Add candidate"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
