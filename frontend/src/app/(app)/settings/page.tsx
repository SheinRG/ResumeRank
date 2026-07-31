import type { Metadata } from "next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";
import { ProfileForm } from "@/components/settings/profile-form";
import { requireUser } from "@/lib/auth/guards";

export const metadata: Metadata = { title: "Profile · Settings" };

export default async function SettingsProfilePage() {
  const user = await requireUser();

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
