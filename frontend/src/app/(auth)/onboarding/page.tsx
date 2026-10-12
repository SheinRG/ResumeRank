import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { GateError, gateRedirectPath, requireUser, type CurrentUser } from "@/lib/auth/guards";
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

async function loadOnboardingUser(): Promise<CurrentUser> {
  try {
    return await requireUser();
  } catch (error) {
    if (error instanceof GateError) {
      redirect(gateRedirectPath(error));
    }
    throw error;
  }
}

/**
 * First-run setup for someone with no workspace, and where anyone else adds
 * one: accepting another company's invite or starting a new company.
 */
async function OnboardingPage() {
  const user = await loadOnboardingUser();
  const member = user.workspaces.length > 0;

  const invites = await db.companyInvite.findMany({
    where: {
      email: user.email,
      acceptedAt: null,
      expiresAt: { gt: new Date() },
      companyId: { notIn: user.workspaces.map((workspace) => workspace.companyId) },
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
          <CardTitle className="text-2xl">
            {member ? "Add a workspace" : "Set up your workspace"}
          </CardTitle>
          <CardDescription>
            {member
              ? "Join another team you were invited to, or start a new company. Your current workspaces stay as they are."
              : "Join a team you were invited to, or start a new company workspace."}
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
          {member ? (
            <Link
              href="/dashboard"
              className="self-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Back to {user.companyName ?? "your workspace"}
            </Link>
          ) : null}
        </CardContent>
      </Card>
    </FadeIn>
  );
}

export default OnboardingPage;
