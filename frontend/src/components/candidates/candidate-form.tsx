"use client";

import { Loader2, Save, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/shared/form-field";
import { CANDIDATE_SOURCE_LABELS } from "@/components/shared/status-badges";
import { cn } from "@/lib/utils";
import { CANDIDATE_SOURCES, type CandidateSource } from "@resumerank/core/validators/enums";
import {
  MIN_RESUME_LENGTH,
  candidateCreateSchema,
  candidateUpdateSchema,
} from "@resumerank/core/validators/candidate";
import { createCandidateAction, updateCandidateAction } from "@/server/actions/candidates";

type FieldErrors = Partial<
  Record<"name" | "email" | "headline" | "source" | "resumeText", string[]>
>;

type CandidateFormValues = {
  name: string;
  email: string;
  headline: string;
  source: CandidateSource;
  resumeText: string;
};

type CandidateFormProps =
  | { mode: "create"; candidate?: undefined }
  | {
      mode: "edit";
      candidate: {
        id: string;
        name: string;
        email: string;
        headline: string | null;
        source: CandidateSource;
        resumeText: string;
      };
    };

export function CandidateForm({ mode, candidate }: CandidateFormProps) {
  const router = useRouter();
  const [values, setValues] = useState<CandidateFormValues>({
    name: candidate?.name ?? "",
    email: candidate?.email ?? "",
    headline: candidate?.headline ?? "",
    source: candidate?.source ?? "MANUAL",
    resumeText: candidate?.resumeText ?? "",
  });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function update<K extends keyof CandidateFormValues>(key: K, value: CandidateFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const input =
      mode === "edit"
        ? { id: candidate.id, ...values }
        : values;
    const schema = mode === "edit" ? candidateUpdateSchema : candidateCreateSchema;
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      setFieldErrors(parsed.error.flatten().fieldErrors as FieldErrors);
      return;
    }
    setFieldErrors({});

    startTransition(async () => {
      const result =
        mode === "edit"
          ? await updateCandidateAction(parsed.data)
          : await createCandidateAction(parsed.data);

      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {});
        setFormError(result.error);
        toast.error(result.error);
        return;
      }

      toast.success(mode === "edit" ? "Candidate updated." : "Candidate added.");
      router.push(`/candidates/${result.data.id}`);
    });
  }

  const resumeLength = values.resumeText.trim().length;
  const resumeBelowMin = resumeLength < MIN_RESUME_LENGTH;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
      {formError ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {formError}
        </p>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField label="Name" htmlFor="candidate-name" errors={fieldErrors.name} required>
          <Input
            id="candidate-name"
            value={values.name}
            onChange={(event) => update("name", event.target.value)}
            required
          />
        </FormField>
        <FormField label="Email" htmlFor="candidate-email" errors={fieldErrors.email} required>
          <Input
            id="candidate-email"
            type="email"
            value={values.email}
            onChange={(event) => update("email", event.target.value)}
            required
          />
        </FormField>
        <FormField
          label="Headline"
          htmlFor="candidate-headline"
          errors={fieldErrors.headline}
          hint="Optional — e.g. Senior backend engineer"
        >
          <Input
            id="candidate-headline"
            value={values.headline}
            onChange={(event) => update("headline", event.target.value)}
          />
        </FormField>
        <FormField label="Source" htmlFor="candidate-source" errors={fieldErrors.source} required>
          <Select
            value={values.source}
            onValueChange={(next) => update("source", next as CandidateSource)}
          >
            <SelectTrigger id="candidate-source" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CANDIDATE_SOURCES.map((option) => (
                <SelectItem key={option} value={option}>
                  {CANDIDATE_SOURCE_LABELS[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      </div>

      <FormField
        label="Resume text"
        htmlFor="candidate-resume"
        errors={fieldErrors.resumeText}
        required
        hint={`Paste the full resume text — at least ${MIN_RESUME_LENGTH} characters so scoring has something to work with.`}
      >
        <Textarea
          id="candidate-resume"
          value={values.resumeText}
          onChange={(event) => update("resumeText", event.target.value)}
          rows={16}
          className="font-mono text-xs leading-relaxed"
          required
        />
      </FormField>
      <p
        className={cn(
          "-mt-3 text-xs",
          resumeBelowMin ? "font-medium text-destructive" : "text-muted-foreground",
        )}
      >
        {resumeLength.toLocaleString()} / {MIN_RESUME_LENGTH.toLocaleString()} characters minimum
      </p>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={isPending}>
          {isPending ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : mode === "edit" ? (
            <Save aria-hidden="true" />
          ) : (
            <UserPlus aria-hidden="true" />
          )}
          {isPending ? "Saving…" : mode === "edit" ? "Save changes" : "Add candidate"}
        </Button>
        <Button type="button" variant="outline" asChild>
          <Link href={mode === "edit" ? `/candidates/${candidate.id}` : "/candidates"}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
