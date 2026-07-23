"use client";

import { Loader2, X } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InviteMemberForm } from "@/components/settings/invite-member-form";
import { formatDate } from "@/lib/format";
import { revokeInviteAction } from "@/server/actions/company";
import type { PendingInvite } from "@/server/queries/users";
import type { Role } from "@resumerank/core/validators/enums";

const ROLE_LABELS: Record<Role, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
  VIEWER: "Viewer",
};

function TeamInvites({ initialInvites }: { initialInvites: PendingInvite[] }) {
  const [invites, setInvites] = useState(initialInvites);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function handleInvited(invite: PendingInvite) {
    setInvites((current) => [
      invite,
      ...current.filter((existing) => existing.email !== invite.email),
    ]);
  }

  function handleRevoke(inviteId: string) {
    const previous = invites;
    setInvites((current) => current.filter((invite) => invite.id !== inviteId));
    setPendingId(inviteId);
    startTransition(async () => {
      const result = await revokeInviteAction(inviteId);
      setPendingId(null);
      if (!result.ok) {
        setInvites(previous);
        toast.error(result.error);
        return;
      }
      toast.success("Invite revoked.");
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <InviteMemberForm onInvited={handleInvited} />
      {invites.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-foreground">Pending invites</p>
          {invites.map((invite) => (
            <div
              key={invite.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5"
            >
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium text-foreground">{invite.email}</span>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Badge variant="outline">{ROLE_LABELS[invite.role]}</Badge>
                  expires {formatDate(invite.expiresAt)} · invited by {invite.invitedByName}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={pendingId === invite.id}
                onClick={() => handleRevoke(invite.id)}
              >
                {pendingId === invite.id ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <X aria-hidden="true" />
                )}
                Revoke
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No pending invites.</p>
      )}
    </div>
  );
}

export { TeamInvites };
