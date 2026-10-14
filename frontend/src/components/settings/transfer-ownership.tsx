"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
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
import { PasswordInput } from "@/components/auth/password-input";
import { FormField } from "@/components/shared/form-field";
import { useActionForm } from "@/components/shared/use-action-form";
import { INVITABLE_ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/roles";
import { transferOwnershipAction } from "@/server/actions/users";
import type { TeamMember } from "@/server/queries/users";
import { transferOwnershipSchema } from "@resumerank/core/validators/company";

type StayAs = (typeof INVITABLE_ROLES)[number];

function isStayAs(value: string): value is StayAs {
  return INVITABLE_ROLES.some((role) => role === value);
}

export function TransferOwnership({
  companyName,
  candidates,
  hasPassword,
}: {
  companyName: string;
  /** Teammates who can take over: not already owners, with a verified email. */
  candidates: TeamMember[];
  hasPassword: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState("");
  const [stayAs, setStayAs] = useState<StayAs>("ADMIN");
  const [confirmName, setConfirmName] = useState("");
  const [password, setPassword] = useState("");
  const { fieldErrors, formError, isPending, submit } = useActionForm({
    schema: transferOwnershipSchema,
    action: transferOwnershipAction,
    onSuccess: ({ newOwner }) => {
      setOpen(false);
      toast.success(`${newOwner.name} now owns ${companyName}.`);
      router.refresh();
    },
  });

  const nameMatches = confirmName.trim().toLowerCase() === companyName.trim().toLowerCase();
  const ready = Boolean(userId) && nameMatches && (!hasPassword || Boolean(password));

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setConfirmName("");
      setPassword("");
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit({
      userId,
      stayAs,
      confirmName: confirmName.trim(),
      password: hasPassword ? password : undefined,
    });
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted-foreground">
        {candidates.length > 0
          ? "Hand the owner role to a teammate. You stay in the workspace with the role you choose, and only they can give ownership back."
          : "Invite a teammate first. Ownership can go to anyone who isn't already an owner and has verified their email."}
      </p>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="destructive"
            className="shrink-0 sm:w-fit"
            disabled={candidates.length === 0}
          >
            Transfer ownership
          </Button>
        </DialogTrigger>
        <DialogContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Transfer ownership?</DialogTitle>
              <DialogDescription>
                The new owner controls sign-in policies, SSO, audit retention and streaming. You
                can&apos;t undo this yourself.
              </DialogDescription>
            </DialogHeader>
            <FormField label="New owner" htmlFor="transfer-owner" errors={fieldErrors.userId} required>
              <Select value={userId} onValueChange={setUserId}>
                <SelectTrigger id="transfer-owner" className="w-full">
                  <SelectValue placeholder="Choose a teammate" />
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.name} · {member.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Your role afterwards" htmlFor="transfer-stay-as" errors={fieldErrors.stayAs} required>
              <Select value={stayAs} onValueChange={(value) => isStayAs(value) && setStayAs(value)}>
                <SelectTrigger id="transfer-stay-as" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INVITABLE_ROLES.map((role) => (
                    <SelectItem key={role} value={role} title={ROLE_DESCRIPTIONS[role]}>
                      {ROLE_LABELS[role]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField
              label={`Type ${companyName} to confirm`}
              errors={fieldErrors.confirmName}
              required
            >
              <Input
                value={confirmName}
                onChange={(event) => setConfirmName(event.target.value)}
                autoComplete="off"
                placeholder={companyName}
              />
            </FormField>
            {hasPassword ? (
              <FormField label="Your password" errors={fieldErrors.password} required>
                <PasswordInput
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                />
              </FormField>
            ) : null}
            {formError ? (
              <p role="alert" className="text-sm text-destructive">
                {formError}
              </p>
            ) : null}
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" variant="destructive" disabled={isPending || !ready}>
                {isPending ? "Transferring…" : "Transfer ownership"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
