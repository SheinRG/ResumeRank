import type { Metadata } from "next";

import { DepartmentsPanel } from "@/components/settings/departments-panel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { can, requireMember } from "@/lib/auth/guards";
import { listDepartments } from "@/server/queries/hiring-team";
import { listTeam } from "@/server/queries/users";

export const metadata: Metadata = { title: "Departments · Settings" };

function MemberView() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Departments</CardTitle>
        <CardDescription>Departments and their members are managed by your workspace admins.</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-foreground">
          Hiring managers and interviewers in a department see every job filed under it.
        </p>
      </CardContent>
    </Card>
  );
}

export default async function SettingsDepartmentsPage() {
  const user = await requireMember();
  if (!can(user.role, "department.manage")) return <MemberView />;

  const [departments, teammates] = await Promise.all([listDepartments(), listTeam()]);
  return <DepartmentsPanel departments={departments} teammates={teammates} />;
}
