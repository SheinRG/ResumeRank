import type { Metadata } from "next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CompanyForm } from "@/components/settings/company-form";
import { canAdmin, requireMember } from "@/lib/auth/guards";
import { getCompany } from "@/server/queries/company";

export const metadata: Metadata = { title: "Company · Settings" };

export default async function SettingsCompanyPage() {
  const user = await requireMember();
  const company = await getCompany();
  const canEdit = canAdmin(user.role);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Company</CardTitle>
          <CardDescription>
            {canEdit
              ? "Update your company's public profile."
              : "Your company's profile. Contact an admin to make changes."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CompanyForm company={company} canEdit={canEdit} />
        </CardContent>
      </Card>
    </div>
  );
}
