"use client";

import { useState, type FormEvent } from "react";
import { signOut } from "next-auth/react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/auth/password-input";
import { FormField } from "@/components/shared/form-field";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useActionForm } from "@/components/shared/use-action-form";
import { deleteAccountSchema } from "@resumerank/core/validators/user";
import { deleteAccountAction } from "@/server/actions/users";

export function DeleteAccount({
  email,
  hasPassword,
}: {
  email: string;
  hasPassword: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [password, setPassword] = useState("");
  const { fieldErrors, isPending, submit } = useActionForm({
    schema: deleteAccountSchema,
    action: deleteAccountAction,
    onSuccess: () => {
      toast.success("Account deleted. Signing you out…");
      void signOut({ callbackUrl: "/" });
    },
    onError: (message) => toast.error(message),
  });

  const emailMatches = confirmEmail.trim().toLowerCase() === email.toLowerCase();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit({
      confirmEmail: confirmEmail.trim(),
      password: hasPassword ? password : undefined,
    });
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">Delete this account</p>
        <p className="text-sm text-muted-foreground">
          Permanently removes your login, reviews and personal data. Jobs,
          candidates and applications you created are transferred to the
          workspace owner. This can’t be undone.
        </p>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="destructive"
            className="shrink-0 sm:w-fit"
          >
            Delete account
          </Button>
        </DialogTrigger>
        <DialogContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Delete your account?</DialogTitle>
              <DialogDescription>
                This is permanent. Type <span className="font-medium text-foreground">{email}</span> to
                confirm.
              </DialogDescription>
            </DialogHeader>
            <FormField label="Your email" errors={fieldErrors.confirmEmail} required>
              <Input
                value={confirmEmail}
                onChange={(event) => setConfirmEmail(event.target.value)}
                autoComplete="off"
                placeholder={email}
              />
            </FormField>
            {hasPassword ? (
              <FormField label="Password" errors={fieldErrors.password} required>
                <PasswordInput
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                />
              </FormField>
            ) : null}
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <Button
                type="submit"
                variant="destructive"
                disabled={isPending || !emailMatches || (hasPassword && !password)}
              >
                {isPending ? "Deleting…" : "Delete account"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
