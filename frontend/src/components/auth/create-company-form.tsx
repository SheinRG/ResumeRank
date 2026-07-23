"use client";

import { useRouter } from "next/navigation";
import { z } from "zod";
import { Building2, Loader2 } from "lucide-react";
import { useState } from "react";

import { AuthAlert } from "@/components/auth/auth-alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/shared/form-field";
import { Input } from "@/components/ui/input";
import { useActionForm } from "@/components/shared/use-action-form";
import { companyNameSchema } from "@resumerank/core/validators/company";
import { createCompanyAction } from "@/server/actions/company";

const createCompanySchema = z.object({ companyName: companyNameSchema });

function CreateCompanyForm() {
  const router = useRouter();
  const [companyName, setCompanyName] = useState("");
  const { fieldErrors, formError, isPending, submit } = useActionForm({
    schema: createCompanySchema,
    action: createCompanyAction,
    onSuccess: () => router.push("/dashboard"),
  });

  function handleSubmit(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    submit({ companyName });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <p className="text-sm font-medium text-foreground">Create your company</p>
      {formError ? <AuthAlert>{formError}</AuthAlert> : null}
      <FormField
        label="Company name"
        htmlFor="onboarding-company-name"
        errors={fieldErrors.companyName}
      >
        <Input
          id="onboarding-company-name"
          name="companyName"
          autoComplete="organization"
          placeholder="Acme Talent"
          value={companyName}
          onChange={(event) => setCompanyName(event.target.value)}
          required
        />
      </FormField>
      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <Building2 aria-hidden="true" />
        )}
        Create company
      </Button>
    </form>
  );
}

export { CreateCompanyForm };
