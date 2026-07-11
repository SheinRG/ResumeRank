"use client";

import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/shared/form-field";
import { updateProfileAction } from "@/server/actions/users";

export function ProfileForm({ name, email }: { name: string; email: string }) {
  const [value, setValue] = useState(name);
  const [errors, setErrors] = useState<string[] | undefined>();
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors(undefined);
    startTransition(async () => {
      const result = await updateProfileAction({ name: value });
      if (!result.ok) {
        setErrors(result.fieldErrors?.name);
        toast.error(result.error);
        return;
      }
      toast.success("Profile updated.");
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <FormField label="Name" errors={errors} required>
        <Input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          maxLength={80}
          required
        />
      </FormField>
      <FormField label="Email" hint="Contact an admin to change your email.">
        <Input value={email} disabled readOnly />
      </FormField>
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}
