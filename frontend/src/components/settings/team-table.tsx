"use client";

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
import { initials } from "@/lib/format";
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
  canManage,
}: {
  members: TeamMember[];
  currentUserId: string;
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

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Member</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Role</TableHead>
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
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
