"use client";

import { ShieldCheck, ShieldOff } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ConfirmDialog } from "@/components/mfa/confirm-dialog";
import { RemoveMemberDialog } from "@/components/settings/remove-member-dialog";
import { Button } from "@/components/ui/button";
import { initials } from "@/lib/format";
import { resetMemberMfaAction } from "@/server/actions/mfa";
import { updateUserRoleAction } from "@/server/actions/users";
import type { TeamMember } from "@/server/queries/users";
import type { Role } from "@resumerank/core/validators/enums";

const ROLE_LABELS: Record<Role, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
  VIEWER: "Viewer",
};
const ROLE_OPTIONS: Role[] = ["OWNER", "ADMIN", "MEMBER", "VIEWER"];

export function TeamTable({
  members,
  currentUserId,
  currentUserRole,
  canManage,
}: {
  members: TeamMember[];
  currentUserId: string;
  currentUserRole: Role;
  canManage: boolean;
}) {
  const [rows, setRows] = useState(members);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function handleRoleChange(userId: string, role: Role) {
    const previous = rows;
    setRows((current) =>
      current.map((member) => (member.id === userId ? { ...member, role } : member)),
    );
    setPendingId(userId);
    startTransition(async () => {
      const result = await updateUserRoleAction({ userId, role });
      setPendingId(null);
      if (!result.ok) {
        setRows(previous);
        toast.error(result.error);
        return;
      }
      toast.success(`${result.data.name}'s role updated to ${ROLE_LABELS[result.data.role]}.`);
    });
  }

  function handleRemoved(userId: string) {
    setRows((current) => current.filter((member) => member.id !== userId));
  }

  // Mirrors the server rule: only an owner may remove (or reset) another owner.
  function canRemove(member: TeamMember) {
    return (
      canManage &&
      member.id !== currentUserId &&
      (member.role !== "OWNER" || currentUserRole === "OWNER")
    );
  }

  async function resetMfa(member: TeamMember): Promise<boolean> {
    const result = await resetMemberMfaAction({ userId: member.id });
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    setRows((current) => current.map((row) => (row.id === member.id ? result.data : row)));
    toast.success(`Reset ${member.name}'s two-factor authentication. They've been signed out.`);
    return true;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Member</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Role</TableHead>
          {canManage ? <TableHead>2FA</TableHead> : null}
          {canManage ? (
            <TableHead className="w-28">
              <span className="sr-only">Actions</span>
            </TableHead>
          ) : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((member) => (
          <TableRow key={member.id}>
            <TableCell>
              <div className="flex items-center gap-3">
                <Avatar className="size-8">
                  {member.image ? (
                    <AvatarImage src={member.image} alt="" />
                  ) : null}
                  <AvatarFallback className="text-xs">
                    {initials(member.name)}
                  </AvatarFallback>
                </Avatar>
                <span className="font-medium text-foreground">{member.name}</span>
              </div>
            </TableCell>
            <TableCell className="text-muted-foreground">{member.email}</TableCell>
            <TableCell>
              {canManage && member.id !== currentUserId ? (
                <Select
                  value={member.role}
                  disabled={pendingId === member.id}
                  onValueChange={(value) => handleRoleChange(member.id, value as Role)}
                >
                  <SelectTrigger size="sm" className="w-32" aria-label={`Change ${member.name}'s role`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map((role) => (
                      <SelectItem key={role} value={role}>
                        {ROLE_LABELS[role]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Badge variant="outline">{ROLE_LABELS[member.role]}</Badge>
              )}
            </TableCell>
            {canManage ? (
              <TableCell>
                {member.mfaEnabledAt ? (
                  <Badge variant="outline" className="border-verdict-strong/40 text-verdict-strong">
                    <ShieldCheck aria-hidden="true" />
                    On
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">
                    Off
                  </Badge>
                )}
              </TableCell>
            ) : null}
            {canManage ? (
              <TableCell className="text-right">
                {canRemove(member) ? (
                  <div className="flex justify-end">
                    {member.mfaEnabledAt ? (
                      <ConfirmDialog
                        trigger={
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-11"
                            aria-label={`Reset ${member.name}'s two-factor authentication`}
                          >
                            <ShieldOff aria-hidden="true" />
                          </Button>
                        }
                        title={`Reset ${member.name}'s two-factor authentication?`}
                        description="Only do this once you've confirmed it's really them, for example on a call. Their authenticator app, passkeys and recovery codes stop working and they're signed out everywhere. If your workspace requires two-factor authentication, they set it up again on their next sign-in."
                        confirmLabel="Reset two-factor"
                        pendingLabel="Resetting…"
                        onConfirm={() => resetMfa(member)}
                      />
                    ) : null}
                    <RemoveMemberDialog
                      userId={member.id}
                      memberName={member.name}
                      onRemoved={handleRemoved}
                    />
                  </div>
                ) : null}
              </TableCell>
            ) : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
