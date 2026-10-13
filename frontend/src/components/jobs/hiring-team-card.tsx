"use client";

import { Loader2, Plus, UserMinus, UsersRound } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { initials } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/roles";
import {
  assignToJobAction,
  setJobDepartmentAction,
  unassignFromJobAction,
} from "@/server/actions/hiring-team";
import type { DepartmentOption, HiringTeam } from "@/server/queries/hiring-team";
import type { TeamMember } from "@/server/queries/users";
import type { ActionResult } from "@resumerank/core/types/action";

const NO_DEPARTMENT = "none";

interface StaffingOptions {
  departments: DepartmentOption[];
  /** Everyone in the workspace, to pick from. */
  teammates: TeamMember[];
  canManageDepartments: boolean;
}

export function HiringTeamCard({
  jobId,
  team,
  staffing,
}: {
  jobId: string;
  team: HiringTeam;
  /** Present for roles that may staff the job; without it the card is read-only. */
  staffing: StaffingOptions | null;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  const [, startTransition] = useTransition();

  const onTeam = new Set(team.members.filter((m) => m.via === "job").map((m) => m.userId));
  const addable = staffing?.teammates.filter((teammate) => !onTeam.has(teammate.id)) ?? [];

  function run<T>(key: string, action: () => Promise<ActionResult<T>>, success: (data: T) => string) {
    setPending(key);
    startTransition(async () => {
      const result = await action();
      setPending(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(success(result.data));
    });
  }

  function handleAdd() {
    if (!selected) return;
    run("add", () => assignToJobAction({ jobId, userId: selected }), (member) => {
      setSelected("");
      return `${member.name} added to the hiring team.`;
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Hiring team</CardTitle>
        <CardDescription>
          Hiring managers and interviewers only see jobs they&apos;re on, directly or through the job&apos;s
          department.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-xs uppercase tracking-wide text-muted-foreground">Department</span>
          {staffing && staffing.departments.length > 0 ? (
            <Select
              value={team.department?.id ?? NO_DEPARTMENT}
              disabled={pending === "department"}
              onValueChange={(value) =>
                run(
                  "department",
                  () =>
                    setJobDepartmentAction({ jobId, departmentId: value === NO_DEPARTMENT ? "" : value }),
                  () => (value === NO_DEPARTMENT ? "Removed from its department." : "Department updated."),
                )
              }
            >
              <SelectTrigger className="w-full sm:w-64" aria-label="Department">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_DEPARTMENT}>No department</SelectItem>
                {staffing.departments.map((department) => (
                  <SelectItem key={department.id} value={department.id}>
                    {department.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="text-sm text-foreground">
              {team.department?.name ?? "None"}
              {staffing && staffing.departments.length === 0 ? (
                <span className="text-muted-foreground">
                  {" · "}
                  {staffing.canManageDepartments ? (
                    <Link
                      href="/settings/departments"
                      className="font-medium text-primary hover:underline"
                    >
                      Create a department
                    </Link>
                  ) : (
                    "An admin can create departments."
                  )}
                </span>
              ) : null}
            </p>
          )}
        </div>

        {team.members.length === 0 ? (
          <div className="flex items-center gap-3 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            <UsersRound className="size-5 shrink-0" aria-hidden="true" />
            <p>
              No one is assigned yet.
              {staffing ? " Add a hiring manager or interviewer below." : null}
            </p>
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {team.members.map((member) => (
              <li key={member.userId} className="flex items-center gap-3 py-2">
                <Avatar className="size-8">
                  {member.image ? <AvatarImage src={member.image} alt="" /> : null}
                  <AvatarFallback className="text-xs">{initials(member.name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{member.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                </div>
                <Badge variant="outline">{ROLE_LABELS[member.role]}</Badge>
                {member.via === "department" ? (
                  <Badge variant="outline" className="text-muted-foreground">
                    Via department
                  </Badge>
                ) : staffing ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${member.name} from the hiring team`}
                    disabled={pending === member.userId}
                    onClick={() =>
                      run(
                        member.userId,
                        () => unassignFromJobAction({ jobId, userId: member.userId }),
                        (removed) => `${removed.name} removed from the hiring team.`,
                      )
                    }
                  >
                    {pending === member.userId ? (
                      <Loader2 className="animate-spin" aria-hidden="true" />
                    ) : (
                      <UserMinus aria-hidden="true" />
                    )}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {staffing && addable.length > 0 ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger className="w-full sm:flex-1" aria-label="Teammate to add">
                <SelectValue placeholder="Choose a teammate" />
              </SelectTrigger>
              <SelectContent>
                {addable.map((teammate) => (
                  <SelectItem key={teammate.id} value={teammate.id}>
                    {teammate.name} · {ROLE_LABELS[teammate.role]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" onClick={handleAdd} disabled={!selected || pending === "add"}>
              {pending === "add" ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <Plus aria-hidden="true" />
              )}
              Add to team
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
