"use client";

import { Loader2, Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/shared/form-field";
import { cn } from "@/lib/utils";
import { scorecardSchema } from "@resumerank/core/validators/application";
import { upsertScorecardAction } from "@/server/actions/scorecards";

const STAR_POSITIONS = [1, 2, 3, 4, 5] as const;
const RATING_LABELS: Record<number, string> = {
  1: "1 — Poor fit",
  2: "2 — Weak",
  3: "3 — Decent",
  4: "4 — Strong",
  5: "5 — Exceptional",
};

export function ScorecardForm({
  applicationId,
  existing,
}: {
  applicationId: string;
  existing: { rating: number; notes: string | null } | null;
}) {
  const router = useRouter();
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [ratingErrors, setRatingErrors] = useState<string[] | undefined>();
  const [notesErrors, setNotesErrors] = useState<string[] | undefined>();
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRatingErrors(undefined);
    setNotesErrors(undefined);

    const parsed = scorecardSchema.safeParse({ applicationId, rating, notes });
    if (!parsed.success) {
      const errors = parsed.error.flatten().fieldErrors;
      setRatingErrors(rating === 0 ? ["Pick a rating from 1 to 5."] : errors.rating);
      setNotesErrors(errors.notes);
      return;
    }

    startTransition(async () => {
      const result = await upsertScorecardAction(parsed.data);
      if (!result.ok) {
        setRatingErrors(result.fieldErrors?.rating);
        setNotesErrors(result.fieldErrors?.notes);
        toast.error(result.error);
        return;
      }
      toast.success(existing ? "Scorecard updated." : "Scorecard saved.");
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-sm font-medium leading-none text-foreground">
          Your rating <span className="text-destructive">*</span>
        </legend>
        <div className="mt-1.5 flex items-center gap-1" role="presentation">
          {STAR_POSITIONS.map((position) => (
            <label
              key={position}
              className="flex size-11 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-accent has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50 has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background"
            >
              <input
                type="radio"
                name="rating"
                value={position}
                checked={rating === position}
                onChange={() => setRating(position)}
                className="sr-only"
                aria-label={RATING_LABELS[position]}
              />
              <Star
                aria-hidden="true"
                className={cn(
                  "size-6 transition-colors",
                  position <= rating
                    ? "fill-amber-400 text-amber-400 dark:fill-amber-500 dark:text-amber-500"
                    : "text-muted-foreground",
                )}
              />
            </label>
          ))}
          {rating > 0 ? (
            <span className="ml-2 text-sm text-muted-foreground">{RATING_LABELS[rating]}</span>
          ) : null}
        </div>
        {ratingErrors?.length ? (
          <p className="text-xs font-medium text-destructive">{ratingErrors[0]}</p>
        ) : null}
      </fieldset>

      <FormField
        label="Notes"
        htmlFor="scorecard-notes"
        errors={notesErrors}
        hint="Optional — what stood out, what to probe in an interview."
      >
        <Textarea
          id="scorecard-notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={3}
          maxLength={2_000}
        />
      </FormField>

      <Button type="submit" disabled={isPending} className="w-fit">
        {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
        {isPending ? "Saving…" : existing ? "Update scorecard" : "Save scorecard"}
      </Button>
    </form>
  );
}
