"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/shared/form-field";
import { useActionForm } from "@/components/shared/use-action-form";
import { updateCompanySchema } from "@resumerank/core/validators/company";
import { updateCompanyAction } from "@/server/actions/company";
import type { CompanyDetail } from "@/server/queries/company";
import { initials } from "@/lib/format";

function DetailRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <p className="text-sm text-muted-foreground">{value ?? "Not set"}</p>
    </div>
  );
}

export function CompanyForm({
  company,
  canEdit,
}: {
  company: CompanyDetail;
  canEdit: boolean;
}) {
  const [name, setName] = useState(company.name);
  const [logoUrl, setLogoUrl] = useState(company.logoUrl ?? "");
  const [website, setWebsite] = useState(company.website ?? "");
  const [description, setDescription] = useState(company.description ?? "");
  const [industry, setIndustry] = useState(company.industry ?? "");
  const [size, setSize] = useState(company.size ?? "");
  const [location, setLocation] = useState(company.location ?? "");

  const { fieldErrors, isPending, submit } = useActionForm({
    schema: updateCompanySchema,
    action: updateCompanyAction,
    onSuccess: (updated) => {
      setName(updated.name);
      setLogoUrl(updated.logoUrl ?? "");
      setWebsite(updated.website ?? "");
      setDescription(updated.description ?? "");
      setIndustry(updated.industry ?? "");
      setSize(updated.size ?? "");
      setLocation(updated.location ?? "");
      toast.success("Company profile updated.");
    },
    onError: (message) => toast.error(message),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit({ name, logoUrl, website, description, industry, size, location });
  }

  const logo = (
    <Avatar className="size-16 rounded-xl">
      {logoUrl ? <AvatarImage src={logoUrl} alt="" className="object-contain" /> : null}
      <AvatarFallback className="rounded-xl text-base">
        {initials(name) || "?"}
      </AvatarFallback>
    </Avatar>
  );

  if (!canEdit) {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-4">
          {logo}
          <div className="flex flex-col gap-0.5">
            <span className="text-base font-semibold text-foreground">
              {company.name}
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              {company.slug}
            </span>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <DetailRow label="Website" value={company.website} />
          <DetailRow label="Industry" value={company.industry} />
          <DetailRow label="Size" value={company.size} />
          <DetailRow label="Location" value={company.location} />
        </div>
        <DetailRow label="Description" value={company.description} />
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        {logo}
        <FormField
          label="Logo URL"
          errors={fieldErrors.logoUrl}
          hint="An https link to a square image."
          className="flex-1"
        >
          <Input
            value={logoUrl}
            onChange={(event) => setLogoUrl(event.target.value)}
            placeholder="https://example.com/logo.png"
          />
        </FormField>
      </div>

      <FormField label="Company name" errors={fieldErrors.name} required>
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={80}
          required
        />
      </FormField>

      <FormField label="Slug" hint="Generated when the company was created.">
        <Input value={company.slug} disabled readOnly className="font-mono" />
      </FormField>

      <FormField label="Website" errors={fieldErrors.website}>
        <Input
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
          placeholder="https://example.com"
        />
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Industry" errors={fieldErrors.industry}>
          <Input
            value={industry}
            onChange={(event) => setIndustry(event.target.value)}
            maxLength={80}
          />
        </FormField>
        <FormField label="Size" errors={fieldErrors.size} hint="e.g. 11-50 employees">
          <Input
            value={size}
            onChange={(event) => setSize(event.target.value)}
            maxLength={40}
          />
        </FormField>
      </div>

      <FormField label="Location" errors={fieldErrors.location}>
        <Input
          value={location}
          onChange={(event) => setLocation(event.target.value)}
          maxLength={120}
        />
      </FormField>

      <FormField label="Description" errors={fieldErrors.description}>
        <Textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={500}
          rows={4}
        />
      </FormField>

      <Button type="submit" disabled={isPending} className="w-fit">
        {isPending ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}
