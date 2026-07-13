"use client";

import { Loader2, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { FormField } from "@/components/shared/form-field";
import { JOB_STATUS_LABELS } from "@/components/shared/status-badges";
import { EMPLOYMENT_TYPE_LABELS } from "@/components/jobs/labels";
import {
  JobRequirementsEditor,
  type RequirementRow,
} from "@/components/jobs/job-requirements-editor";
import { EMPLOYMENT_TYPES, JOB_STATUSES } from "@resumerank/core/validators/enums";
import type { EmploymentType, JobStatus } from "@resumerank/core/validators/enums";
import { jobCreateSchema, jobUpdateSchema } from "@resumerank/core/validators/job";
import { createJobAction, updateJobAction } from "@/server/actions/jobs";
import type { JobDetail } from "@/server/queries/jobs";

function newClientId(): string {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `req-${Date.now()}`;
}

function rowsFromJob(job?: JobDetail): RequirementRow[] {
  if (!job || job.requirements.length === 0) {
    return [{ clientId: newClientId(), label: "", weight: "MUST" }];
  }
  return job.requirements.map((requirement) => ({
    clientId: requirement.id,
    id: requirement.id,
    label: requirement.label,
    weight: requirement.weight,
  }));
}

export function JobForm({ job }: { job?: JobDetail }) {
  const router = useRouter();
  const [title, setTitle] = useState(job?.title ?? "");
  const [description, setDescription] = useState(job?.description ?? "");
  const [location, setLocation] = useState(job?.location ?? "");
  const [employmentType, setEmploymentType] = useState<EmploymentType>(
    job?.employmentType ?? "FULL_TIME",
  );
  const [status, setStatus] = useState<JobStatus>(job?.status ?? "DRAFT");
  const [rows, setRows] = useState<RequirementRow[]>(() => rowsFromJob(job));

  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [requirementErrors, setRequirementErrors] = useState<Record<string, string[]>>({});
  const [requirementsListError, setRequirementsListError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const payload = {
      title,
      description,
      location,
      employmentType,
      status,
      requirements: rows.map((row) => ({
        id: row.id,
        label: row.label,
        weight: row.weight,
      })),
    };

    const parsed = job
      ? jobUpdateSchema.safeParse({ ...payload, id: job.id })
      : jobCreateSchema.safeParse(payload);

    if (!parsed.success) {
      const nextFieldErrors: Record<string, string[]> = {};
      const nextRequirementErrors: Record<string, string[]> = {};
      let nextListError: string | undefined;

      for (const issue of parsed.error.issues) {
        const [first, second] = issue.path;
        if (first === "requirements") {
          if (typeof second === "number") {
            const clientId = rows[second]?.clientId;
            if (clientId) {
              nextRequirementErrors[clientId] = [
                ...(nextRequirementErrors[clientId] ?? []),
                issue.message,
              ];
            }
          } else {
            nextListError = issue.message;
          }
          continue;
        }
        const key = String(first);
        nextFieldErrors[key] = [...(nextFieldErrors[key] ?? []), issue.message];
      }

      setFieldErrors(nextFieldErrors);
      setRequirementErrors(nextRequirementErrors);
      setRequirementsListError(nextListError);
      return;
    }

    setFieldErrors({});
    setRequirementErrors({});
    setRequirementsListError(undefined);

    startTransition(async () => {
      const result = job
        ? await updateJobAction(parsed.data)
        : await createJobAction(parsed.data);

      if (!result.ok) {
        setFormError(result.error);
        if (result.fieldErrors) {
          const { requirements, ...rest } = result.fieldErrors;
          setFieldErrors(rest);
          if (requirements) setRequirementsListError(requirements.join(" "));
        }
        return;
      }

      toast.success(job ? "Job updated." : "Job created.");
      router.push(`/jobs/${result.data.id}`);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6" noValidate>
      {formError ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {formError}
        </p>
      ) : null}

      <FormField label="Title" htmlFor="job-title" errors={fieldErrors.title} required>
        <Input
          id="job-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="e.g. Senior Backend Engineer"
          required
        />
      </FormField>

      <FormField
        label="Description"
        htmlFor="job-description"
        errors={fieldErrors.description}
        hint="At least 30 characters."
        required
      >
        <Textarea
          id="job-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={6}
          placeholder="What will this person do? What does the team look like?"
          required
        />
      </FormField>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Location" htmlFor="job-location" errors={fieldErrors.location}>
          <Input
            id="job-location"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            placeholder="Remote, or city"
          />
        </FormField>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="job-employment-type">Employment type</Label>
          <Select
            value={employmentType}
            onValueChange={(value) => setEmploymentType(value as EmploymentType)}
          >
            <SelectTrigger id="job-employment-type" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EMPLOYMENT_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {EMPLOYMENT_TYPE_LABELS[type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {fieldErrors.employmentType?.map((message) => (
            <p key={message} className="text-xs font-medium text-destructive">
              {message}
            </p>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5 sm:w-60">
        <Label htmlFor="job-status">Status</Label>
        <Select value={status} onValueChange={(value) => setStatus(value as JobStatus)}>
          <SelectTrigger id="job-status" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {JOB_STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {JOB_STATUS_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {fieldErrors.status?.map((message) => (
          <p key={message} className="text-xs font-medium text-destructive">
            {message}
          </p>
        ))}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Requirements</Label>
        <p className="text-xs text-muted-foreground">
          This is the rubric AI scoring will grade candidates against. Mark each as must-have or
          nice-to-have and order them by priority.
        </p>
        <JobRequirementsEditor
          rows={rows}
          onChange={setRows}
          errors={requirementErrors}
          listError={requirementsListError}
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={pending}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
          {job ? "Save changes" : "Create job"}
        </Button>
      </div>
    </form>
  );
}
