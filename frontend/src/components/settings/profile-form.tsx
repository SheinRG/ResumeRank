"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { FormField } from "@/components/shared/form-field";
import { useActionForm } from "@/components/shared/use-action-form";
import { updateProfileSchema } from "@resumerank/core/validators/user";
import { updateProfileAction } from "@/server/actions/users";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

export function ProfileForm({
  name,
  email,
  image,
}: {
  name: string;
  email: string;
  image: string | null;
}) {
  const [nameValue, setNameValue] = useState(name);
  const [imageValue, setImageValue] = useState(image ?? "");
  const { fieldErrors, isPending, submit } = useActionForm({
    schema: updateProfileSchema,
    action: updateProfileAction,
    onSuccess: () => toast.success("Profile updated."),
    onError: (message) => toast.error(message),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit({ name: nameValue, image: imageValue.trim() });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <Avatar className="size-14">
          {imageValue ? <AvatarImage src={imageValue} alt="" /> : null}
          <AvatarFallback>{initials(nameValue)}</AvatarFallback>
        </Avatar>
        <FormField
          label="Avatar URL"
          errors={fieldErrors.image}
          hint="Paste an https link to an image, or leave blank."
          className="flex-1"
        >
          <Input
            value={imageValue}
            onChange={(event) => setImageValue(event.target.value)}
            placeholder="https://…"
            inputMode="url"
            maxLength={2048}
          />
        </FormField>
      </div>
      <FormField label="Name" errors={fieldErrors.name} required>
        <Input
          value={nameValue}
          onChange={(event) => setNameValue(event.target.value)}
          maxLength={80}
          required
        />
      </FormField>
      <FormField label="Email" hint="Contact an admin to change your email.">
        <Input value={email} disabled readOnly />
      </FormField>
      <Button type="submit" disabled={isPending} className="w-fit">
        {isPending ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}
