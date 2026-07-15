import type { Metadata } from "next";

import { db } from "@resumerank/core/db";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireUser } from "@/lib/auth/guards";
import { ChangePasswordForm } from "@/components/settings/change-password-form";
import { NotificationSettings } from "@/components/settings/notification-settings";
import { DeleteAccount } from "@/components/settings/delete-account";

export const metadata: Metadata = { title: "Account · Settings" };

export default async function SettingsAccountPage() {
  const user = await requireUser();
  const record = await db.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true, notifyByEmail: true },
  });
  const hasPassword = Boolean(record?.passwordHash);
  const notifyByEmail = record?.notifyByEmail ?? true;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>
            {hasPassword
              ? "Update the password you use to sign in."
              : "You sign in with Google, so there's no password to change here."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {hasPassword ? (
            <ChangePasswordForm />
          ) : (
            <p className="text-sm text-muted-foreground">
              Manage your password through your Google account.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
          <CardDescription>Choose which emails ResumeRank sends you.</CardDescription>
        </CardHeader>
        <CardContent>
          <NotificationSettings notifyByEmail={notifyByEmail} />
        </CardContent>
      </Card>

      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-destructive">Danger zone</CardTitle>
          <CardDescription>Irreversible account actions.</CardDescription>
        </CardHeader>
        <CardContent>
          <DeleteAccount email={user.email} hasPassword={hasPassword} />
        </CardContent>
      </Card>
    </div>
  );
}
