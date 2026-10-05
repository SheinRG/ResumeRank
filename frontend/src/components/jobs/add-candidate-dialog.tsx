"use client";

import { Check, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { createApplicationAction } from "@/server/actions/applications";
import type { CandidateOption } from "@/server/queries/candidates";

const SEARCH_DEBOUNCE_MS = 250;

const optionsSchema = z.array(z.object({ id: z.string(), name: z.string(), email: z.string() }));

type SearchState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; query: string; options: CandidateOption[] };

/**
 * Searches the server as the user types instead of shipping every candidate
 * to the page: the list is bounded per query and skips anyone already in
 * this job's pipeline.
 */
export function AddCandidateDialog({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<CandidateOption | null>(null);
  const [search, setSearch] = useState<SearchState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const trimmed = query.trim();
    const handle = setTimeout(
      async () => {
        setSearch({ status: "loading" });
        try {
          const params = new URLSearchParams({ q: trimmed });
          const response = await fetch(`/api/jobs/${jobId}/candidate-options?${params}`, {
            cache: "no-store",
            signal: controller.signal,
          });
          if (!response.ok) throw new Error(`status ${response.status}`);
          const options = optionsSchema.parse(await response.json());
          setSearch({ status: "ready", query: trimmed, options });
        } catch {
          if (!controller.signal.aborted) setSearch({ status: "error" });
        }
      },
      trimmed ? SEARCH_DEBOUNCE_MS : 0,
    );
    return () => {
      clearTimeout(handle);
      controller.abort();
    };
  }, [open, query, jobId, attempt]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setQuery("");
      setSelected(null);
      setError(null);
      setSearch({ status: "loading" });
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) {
      setError("Pick a candidate.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await createApplicationAction({ jobId, candidateId: selected.id });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("Candidate added to the pipeline.");
      handleOpenChange(false);
      router.refresh();
    });
  }

  const noneAvailable = search.status === "ready" && search.query === "" && search.options.length === 0;

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

          {noneAvailable ? (
            <p className="text-sm text-muted-foreground">
              No candidates left to add — everyone is already in this pipeline, or you
              haven&apos;t added any yet.{" "}
              <Link href="/candidates/new" className="font-medium text-primary hover:underline">
                Add a candidate
              </Link>
              .
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label id="add-candidate-label">Candidate</Label>
              {/* cmdk owns the input's id, so it labels the input through its own `label`. */}
              <Command
                label="Search candidates by name or email"
                shouldFilter={false}
                className="rounded-lg border border-border"
                aria-invalid={error ? true : undefined}
              >
                <CommandInput
                  aria-describedby="add-candidate-label"
                  placeholder="Search by name or email"
                  value={query}
                  onValueChange={setQuery}
                />
                <CommandList className="max-h-64">
                  {search.status === "loading" ? (
                    <div className="flex flex-col gap-2 p-2" aria-busy="true" aria-label="Loading candidates">
                      {Array.from({ length: 4 }, (_, i) => (
                        <Skeleton key={i} className="h-9 w-full rounded-md" />
                      ))}
                    </div>
                  ) : search.status === "error" ? (
                    <div className="flex flex-col items-center gap-2 p-4 text-center text-sm">
                      <p className="text-muted-foreground">
                        We couldn&apos;t load candidates. Check your connection and try again.
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setAttempt((n) => n + 1)}
                      >
                        Retry
                      </Button>
                    </div>
                  ) : (
                    <>
                      <CommandEmpty>No candidates match &ldquo;{search.query}&rdquo;.</CommandEmpty>
                      {search.options.map((candidate) => (
                        <CommandItem
                          key={candidate.id}
                          value={candidate.id}
                          onSelect={() => {
                            setSelected(candidate);
                            setError(null);
                          }}
                        >
                          <Check
                            aria-hidden="true"
                            className={cn(
                              "size-4",
                              selected?.id === candidate.id ? "opacity-100" : "opacity-0",
                            )}
                          />
                          <span className="truncate">
                            {candidate.name}
                            <span className="text-muted-foreground"> · {candidate.email}</span>
                          </span>
                        </CommandItem>
                      ))}
                    </>
                  )}
                </CommandList>
              </Command>
              {selected ? (
                <p className="text-xs text-muted-foreground">
                  Selected: <span className="font-medium text-foreground">{selected.name}</span>
                </p>
              ) : null}
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
            <Button type="submit" disabled={pending || noneAvailable}>
              {pending ? "Adding…" : "Add candidate"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
