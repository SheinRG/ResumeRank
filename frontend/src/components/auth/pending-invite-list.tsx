"use client";

import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";

import { AuthAlert } from "@/components/auth/auth-alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { acceptPendingInviteAction } from "@/server/actions/company";
import type { Role } from "@resumerank/core/validators/enums";

const ROLE_LABELS: Record<Role, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
  VIEWER: "Viewer",
};

export interface OnboardingInvite {
  id: string;
  role: Role;
  companyName: string;
  inviterName: string;
}

function PendingInviteList({ invites }: { invites: OnboardingInvite[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleAccept(inviteId: string) {
    setError(null);
    setPendingId(inviteId);
    startTransition(async () => {
      const result = await acceptPendingInviteAction(inviteId);
      if (!result.ok) {
        setPendingId(null);
        setError(result.error);
        return;
      }
      router.push("/dashboard");
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium text-foreground">Your invites</p>
      {error ? <AuthAlert>{error}</AuthAlert> : null}
      <div className="flex flex-col gap-2">
        {invites.map((invite) => (
          <div
            key={invite.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5"
          >
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-foreground">
                {invite.companyName}
              </span>
              <span className="text-xs text-muted-foreground">
                Invited by {invite.inviterName} ·{" "}
                <Badge variant="outline" className="align-middle">
                  {ROLE_LABELS[invite.role]}
                </Badge>
              </span>
            </div>
            <Button
              size="sm"
              disabled={isPending && pendingId === invite.id}
              onClick={() => handleAccept(invite.id)}
            >
              {isPending && pendingId === invite.id ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : null}
              Accept
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

export { PendingInviteList };
