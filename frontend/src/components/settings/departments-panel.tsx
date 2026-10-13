"use client";

import { Building2, Check, Loader2, Pencil, Plus, Trash2, UserMinus, X } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/mfa/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { FormField } from "@/components/shared/form-field";
import { useActionForm } from "@/components/shared/use-action-form";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
  addDepartmentMemberAction,
  createDepartmentAction,
  deleteDepartmentAction,
  removeDepartmentMemberAction,
  renameDepartmentAction,
} from "@/server/actions/departments";
import type { DepartmentItem } from "@/server/queries/hiring-team";
import type { TeamMember } from "@/server/queries/users";
import { departmentCreateSchema, departmentRenameSchema } from "@resumerank/core/validators/department";

function CreateDepartmentForm() {
  const [name, setName] = useState("");
  const { fieldErrors, formError, isPending, submit } = useActionForm({
    schema: departmentCreateSchema,
    action: createDepartmentAction,
    onSuccess: (department) => {
      toast.success(`${department.name} created.`);
      setName("");
    },
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit({ name });
      }}
      className="flex flex-col gap-2"
      noValidate
    >
      {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <FormField label="New department" htmlFor="department-name" errors={fieldErrors.name} className="flex-1">
          <Input
            id="department-name"
            placeholder="Engineering"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </FormField>
        <Button type="submit" disabled={isPending}>
          {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Plus aria-hidden="true" />}
          Create
        </Button>
      </div>
    </form>
  );
}

function RenameForm({ department, onDone }: { department: DepartmentItem; onDone: () => void }) {
  const [name, setName] = useState(department.name);
  const { fieldErrors, isPending, submit } = useActionForm({
    schema: departmentRenameSchema,
    action: renameDepartmentAction,
    onSuccess: (renamed) => {
      toast.success(`Renamed to ${renamed.name}.`);
      onDone();
    },
    onError: (message) => toast.error(message),
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit({ id: department.id, name });
      }}
      className="flex flex-1 items-start gap-2"
      noValidate
    >
      <FormField label="Name" htmlFor={`rename-${department.id}`} errors={fieldErrors.name} className="flex-1">
        <Input id={`rename-${department.id}`} value={name} onChange={(event) => setName(event.target.value)} />
      </FormField>
      <Button type="submit" size="icon" aria-label="Save name" disabled={isPending} className="mt-6">
        {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
      </Button>
      <Button type="button" variant="ghost" size="icon" aria-label="Cancel" onClick={onDone} className="mt-6">
        <X aria-hidden="true" />
      </Button>
    </form>
  );
}

function DepartmentCard({ department, teammates }: { department: DepartmentItem; teammates: TeamMember[] }) {
  const [renaming, setRenaming] = useState(false);
  const [selected, setSelected] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const inDepartment = new Set(department.members.map((member) => member.userId));
  const addable = teammates.filter((teammate) => !inDepartment.has(teammate.id));

  function addMember() {
    if (!selected) return;
    setPending("add");
    startTransition(async () => {
      const result = await addDepartmentMemberAction({ departmentId: department.id, userId: selected });
      setPending(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setSelected("");
      toast.success(`${result.data.name} added to ${department.name}.`);
    });
  }

  function removeMember(userId: string) {
    setPending(userId);
    startTransition(async () => {
      const result = await removeDepartmentMemberAction({ departmentId: department.id, userId });
      setPending(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${result.data.name} removed from ${department.name}.`);
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          {renaming ? (
            <RenameForm department={department} onDone={() => setRenaming(false)} />
          ) : (
            <div className="flex min-w-0 flex-col gap-1.5">
              <CardTitle className="truncate">{department.name}</CardTitle>
              <CardDescription>
                {department.jobCount} job{department.jobCount === 1 ? "" : "s"} ·{" "}
                {department.members.length} member{department.members.length === 1 ? "" : "s"}
              </CardDescription>
            </div>
          )}
          {renaming ? null : (
            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Rename ${department.name}`}
                onClick={() => setRenaming(true)}
              >
                <Pencil aria-hidden="true" />
              </Button>
              <ConfirmDialog
                trigger={
                  <Button type="button" variant="ghost" size="icon" aria-label={`Delete ${department.name}`}>
                    <Trash2 aria-hidden="true" />
                  </Button>
                }
                title={`Delete ${department.name}?`}
                description="Its jobs stay, filed under no department. People who reached them only through it lose access."
                confirmLabel="Delete department"
                pendingLabel="Deleting…"
                onConfirm={async () => {
                  const result = await deleteDepartmentAction({ id: department.id });
                  if (!result.ok) {
                    toast.error(result.error);
                    return false;
                  }
                  toast.success(`${department.name} deleted.`);
                  return true;
                }}
              />
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {department.members.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No members yet. Members see every job filed under this department.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {department.members.map((member) => (
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
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${member.name} from ${department.name}`}
                  disabled={pending === member.userId}
                  onClick={() => removeMember(member.userId)}
                >
                  {pending === member.userId ? (
                    <Loader2 className="animate-spin" aria-hidden="true" />
                  ) : (
                    <UserMinus aria-hidden="true" />
                  )}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {addable.length > 0 ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger className="w-full sm:flex-1" aria-label={`Teammate to add to ${department.name}`}>
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
            <Button type="button" variant="outline" onClick={addMember} disabled={!selected || pending === "add"}>
              {pending === "add" ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <Plus aria-hidden="true" />
              )}
              Add member
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function DepartmentsPanel({
  departments,
  teammates,
}: {
  departments: DepartmentItem[];
  teammates: TeamMember[];
}) {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Departments</CardTitle>
          <CardDescription>
            Hiring managers and interviewers in a department see every job filed under it. File a job from
            its Hiring team panel.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CreateDepartmentForm />
        </CardContent>
      </Card>

      {departments.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No departments yet"
          description="Create one above, add its people, then file jobs under it."
        />
      ) : (
        departments.map((department) => (
          <DepartmentCard key={department.id} department={department} teammates={teammates} />
        ))
      )}
    </div>
  );
}
