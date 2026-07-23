"use client";

import { Loader2, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { FormField } from "@/components/shared/form-field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useActionForm } from "@/components/shared/use-action-form";
import { inviteMemberSchema } from "@resumerank/core/validators/company";
import { inviteMemberAction } from "@/server/actions/company";
import type { PendingInvite } from "@/server/queries/users";

type InviteRole = "ADMIN" | "MEMBER" | "VIEWER";

const ROLE_LABELS: Record<InviteRole, string> = {
  ADMIN: "Admin",
  MEMBER: "Member",
  VIEWER: "Viewer",
};
const ROLE_OPTIONS: InviteRole[] = ["ADMIN", "MEMBER", "VIEWER"];

function InviteMemberForm({
  onInvited,
}: {
  onInvited: (invite: PendingInvite) => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("MEMBER");
  const { fieldErrors, formError, isPending, submit } = useActionForm({
    schema: inviteMemberSchema,
    action: inviteMemberAction,
    onSuccess: (invite) => {
      toast.success(`Invite sent to ${invite.email}.`);
      onInvited({
        id: invite.id,
        email: invite.email,
        role: invite.role,
        expiresAt: invite.expiresAt,
        invitedByName: "You",
      });
      setEmail("");
    },
  });

  function handleSubmit(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    submit({ email, role });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
      {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <FormField
          label="Invite teammate"
          htmlFor="invite-email"
          errors={fieldErrors.email}
          className="flex-1"
        >
          <Input
            id="invite-email"
            name="email"
            type="email"
            autoComplete="off"
            placeholder="teammate@company.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </FormField>
        <FormField
          label="Role"
          htmlFor="invite-role"
          errors={fieldErrors.role}
          className="sm:w-36"
        >
          <Select value={role} onValueChange={(value) => setRole(value as InviteRole)}>
            <SelectTrigger id="invite-role" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLE_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {ROLE_LABELS[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <Button type="submit" disabled={isPending}>
          {isPending ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <Send aria-hidden="true" />
          )}
          Send invite
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Inviting the same email again re-sends the invite link.
      </p>
    </form>
  );
}

export { InviteMemberForm };
