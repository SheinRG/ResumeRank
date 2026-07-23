import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { db } from "@resumerank/core/db";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { FadeIn } from "@/components/motion";
import { PendingInviteList } from "@/components/auth/pending-invite-list";
import { CreateCompanyForm } from "@/components/auth/create-company-form";

export const metadata: Metadata = {
  title: "Set up your workspace",
};

async function OnboardingPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, companyId: true },
  });
  if (!user) {
    redirect("/login");
  }
  if (user.companyId) {
    redirect("/dashboard");
  }

  const invites = await db.companyInvite.findMany({
    where: {
      email: user.email,
      acceptedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: {
      company: { select: { name: true } },
      invitedBy: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <FadeIn>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Set up your workspace</CardTitle>
          <CardDescription>
            Join a team you were invited to, or start a new company workspace.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {invites.length > 0 ? (
            <>
              <PendingInviteList
                invites={invites.map((invite) => ({
                  id: invite.id,
                  role: invite.role,
                  companyName: invite.company.name,
                  inviterName: invite.invitedBy.name,
                }))}
              />
              <div className="flex items-center gap-3">
                <Separator className="flex-1" />
                <span className="text-xs text-muted-foreground">or</span>
                <Separator className="flex-1" />
              </div>
            </>
          ) : null}
          <CreateCompanyForm />
        </CardContent>
      </Card>
    </FadeIn>
  );
}

export default OnboardingPage;
