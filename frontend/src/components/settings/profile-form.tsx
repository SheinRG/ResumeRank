"use client";

import { useRef, useState, type DragEvent, type FormEvent } from "react";
import { toast } from "sonner";
import { ImageUp, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { FormField } from "@/components/shared/form-field";
import { useActionForm } from "@/components/shared/use-action-form";
import { updateProfileSchema } from "@resumerank/core/validators/user";
import { updateProfileAction } from "@/server/actions/users";
import { AvatarImageError, fileToAvatarDataUrl } from "@/lib/avatar-image";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

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
  const [imageError, setImageError] = useState<string | null>(null);
  const [isReadingFile, setIsReadingFile] = useState(false);
  const [isDropTarget, setIsDropTarget] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { fieldErrors, isPending, submit } = useActionForm({
    schema: updateProfileSchema,
    action: updateProfileAction,
    onSuccess: () => toast.success("Profile updated."),
    onError: (message) => toast.error(message),
  });

  async function acceptFile(file: File | undefined) {
    if (!file) return;
    setImageError(null);
    setIsReadingFile(true);
    try {
      setImageValue(await fileToAvatarDataUrl(file));
    } catch (error) {
      setImageError(
        error instanceof AvatarImageError
          ? error.message
          : "That image couldn't be processed. Try another one.",
      );
    } finally {
      setIsReadingFile(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDropTarget(false);
    void acceptFile(event.dataTransfer.files[0]);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit({ name: nameValue, image: imageValue });
  }

  const errors = imageError ? [imageError] : fieldErrors.image;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-foreground">Photo</span>
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setIsDropTarget(true);
          }}
          onDragLeave={() => setIsDropTarget(false)}
          onDrop={handleDrop}
          className={cn(
            "flex items-center gap-4 rounded-2xl border border-dashed border-border p-4 transition-colors",
            isDropTarget && "border-primary bg-accent/10",
          )}
        >
          <Avatar className="size-16">
            {imageValue ? <AvatarImage src={imageValue} alt="" /> : null}
            <AvatarFallback>{initials(nameValue) || "?"}</AvatarFallback>
          </Avatar>
          <div className="flex flex-col items-start gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isReadingFile}
                onClick={() => fileInputRef.current?.click()}
              >
                {isReadingFile ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <ImageUp aria-hidden="true" />
                )}
                {imageValue ? "Change photo" : "Upload photo"}
              </Button>
              {imageValue ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setImageValue("");
                    setImageError(null);
                  }}
                >
                  Remove
                </Button>
              ) : null}
            </div>
            {errors && errors.length > 0 ? (
              <ul className="flex flex-col gap-0.5">
                {errors.map((error) => (
                  <li key={error} className="text-xs font-medium text-destructive">
                    {error}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">
                Drop an image here or choose a file — it&rsquo;s cropped to a
                square and resized for you.
              </p>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            aria-label="Upload a profile photo"
            onChange={(event) => {
              void acceptFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </div>
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
      <Button type="submit" disabled={isPending || isReadingFile} className="w-fit">
        {isPending ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}
