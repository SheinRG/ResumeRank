"use client";

import { Eye, LogOut, MailCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { DateText } from "@/components/format/format-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROLE_LABELS } from "@/lib/roles";
import {
  staffLiftSuppressionAction,
  staffSignOutMemberAction,
  staffStartSupportSessionAction,
} from "@/server/actions/staff";
import type { StaffMemberRow } from "@resumerank/core/staff/companies";
import { actionError } from "@resumerank/core/types/action";
import {
  liftSuppressionSchema,
  staffMemberActionSchema,
  SUPPORT_SESSION_MINUTES,
  supportSessionStartSchema,
} from "@resumerank/core/validators/staff";
import { ReasonDialog } from "./reason-dialog";

type Pending =
  | { kind: "view"; member: StaffMemberRow }
  | { kind: "sign-out"; member: StaffMemberRow }
  | { kind: "lift"; email: string };

const INVALID = "Check the highlighted fields.";

export function CompanyMembers({
  companyId,
  companyName,
  members,
  supportAccess,
}: {
  companyId: string;
  companyName: string;
  members: StaffMemberRow[];
  /** Whether the workspace grants support access right now. */
  supportAccess: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<Pending | null>(null);
  const [minutes, setMinutes] = useState<string>("30");
  const close = (open: boolean) => !open && setPending(null);

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Member</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Security</TableHead>
            <TableHead>Last seen</TableHead>
            <TableHead className="text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((member) => (
            <TableRow key={member.userId}>
              <TableCell>
                <div className="flex flex-col">
                  <span className="font-medium text-foreground">{member.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{member.email}</span>
                </div>
              </TableCell>
              <TableCell>{ROLE_LABELS[member.role]}</TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {member.hasSecondFactor ? <Badge variant="outline">2FA</Badge> : null}
                  {!member.emailVerified ? <Badge variant="outline">Unverified</Badge> : null}
                  {member.suppressed ? <Badge variant="destructive">Email suppressed</Badge> : null}
                </div>
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {member.lastSeenAt ? <DateText value={member.lastSeenAt} kind="relative" /> : "Never"}
              </TableCell>
              <TableCell>
                <div className="flex justify-end gap-1">
                  {member.suppressed ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setPending({ kind: "lift", email: member.email })}
                    >
                      <MailCheck aria-hidden="true" />
                      Let email through
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setPending({ kind: "sign-out", member })}
                  >
                    <LogOut aria-hidden="true" />
                    Sign out
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!supportAccess}
                    title={supportAccess ? undefined : `${companyName} hasn't granted support access`}
                    onClick={() => setPending({ kind: "view", member })}
                  >
                    <Eye aria-hidden="true" />
                    View as
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <ReasonDialog
        open={pending?.kind === "view"}
        onOpenChange={close}
        title={pending?.kind === "view" ? `View as ${pending.member.name}` : "View as"}
        description={`You'll see ${companyName} as they do, read-only: nothing can be changed, exported or sent. The workspace's activity log records the session and your reason.`}
        confirmLabel="Start support session"
        onConfirm={async (reason) => {
          if (pending?.kind !== "view") return actionError<never>(INVALID);
          const parsed = supportSessionStartSchema.safeParse({
            companyId,
            userId: pending.member.userId,
            reason,
            minutes: Number(minutes),
          });
          if (!parsed.success) return actionError<never>(INVALID, parsed.error.flatten().fieldErrors);
          return staffStartSupportSessionAction(parsed.data);
        }}
        onDone={() => {
          router.push("/dashboard");
          router.refresh();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="support-session-minutes">Ends after</Label>
          <Select value={minutes} onValueChange={setMinutes}>
            <SelectTrigger id="support-session-minutes" className="w-full sm:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SUPPORT_SESSION_MINUTES.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  {option} minutes
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </ReasonDialog>

      <ReasonDialog
        open={pending?.kind === "sign-out"}
        onOpenChange={close}
        title={pending?.kind === "sign-out" ? `Sign ${pending.member.name} out everywhere` : "Sign out everywhere"}
        description="Ends every session of their account, in every workspace they belong to, for a lost device or a suspected takeover. Each of those workspaces records it."
        confirmLabel="Sign out everywhere"
        destructive
        onConfirm={async (reason) => {
          if (pending?.kind !== "sign-out") return actionError<never>(INVALID);
          const parsed = staffMemberActionSchema.safeParse({ companyId, userId: pending.member.userId, reason });
          if (!parsed.success) return actionError<never>(INVALID, parsed.error.flatten().fieldErrors);
          return staffSignOutMemberAction(parsed.data);
        }}
        onDone={({ revoked }) => {
          toast.success(revoked === 1 ? "Ended 1 session." : `Ended ${revoked} sessions.`);
          router.refresh();
        }}
      />

      <ReasonDialog
        open={pending?.kind === "lift"}
        onOpenChange={close}
        title="Let email through again"
        description={`Mail to ${pending?.kind === "lift" ? pending.email : "this address"} stopped after a bounce or complaint. Lift it once the mailbox is fixed; another bounce suppresses it again.`}
        confirmLabel="Let email through"
        onConfirm={async (reason) => {
          if (pending?.kind !== "lift") return actionError<never>(INVALID);
          const parsed = liftSuppressionSchema.safeParse({ companyId, email: pending.email, reason });
          if (!parsed.success) return actionError<never>(INVALID, parsed.error.flatten().fieldErrors);
          return staffLiftSuppressionAction(parsed.data);
        }}
        onDone={({ lifted }) => {
          toast.success(lifted ? "Email can reach them again." : "That address wasn't suppressed.");
          router.refresh();
        }}
      />
    </>
  );
}
