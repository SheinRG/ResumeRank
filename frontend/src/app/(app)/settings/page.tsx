import type { Metadata } from "next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";
import { FormatSettings } from "@/components/settings/format-settings";
import { ProfileForm } from "@/components/settings/profile-form";
import { requireUser } from "@/lib/auth/guards";
import { listTimeZones } from "@resumerank/core/locale";
import { getCompany } from "@/server/queries/company";

export const metadata: Metadata = { title: "Profile · Settings" };

export default async function SettingsProfilePage() {
  const [user, company] = await Promise.all([requireUser(), getCompany()]);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            Update your photo and display name.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm
            name={user.name}
            email={user.email}
            image={user.image}
          />
        </CardContent>
      </Card>
      <FormatSettings
        scope="personal"
        own={user.ownFormat}
        workspace={{ locale: company.locale, timeZone: company.timeZone }}
        timeZones={listTimeZones()}
      />
      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>
            Choose how ResumeRank looks on this device.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <p className="text-sm text-foreground">Theme</p>
          <ThemeToggle />
        </CardContent>
      </Card>
    </div>
  );
}
