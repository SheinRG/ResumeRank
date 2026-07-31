import type { Metadata } from "next";
import Link from "next/link";
import { CircleX } from "lucide-react";

import { auth } from "@/lib/auth";
import { db } from "@resumerank/core/db";
import { consumeInviteToken } from "@resumerank/core/auth/tokens";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FadeIn } from "@/components/motion";
import { InviteJoinButton } from "@/components/auth/invite-join-button";
import { InviteSignupForm } from "@/components/auth/invite-signup-form";

export const metadata: Metadata = {
  title: "Join your team",
};

type InvitePageProps = {
  searchParams: Promise<{ token?: string }>;
};

function ErrorCard({ heading, message }: { heading: string; message: string }) {
  return (
    <FadeIn>
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-2 text-center">
          <CircleX className="size-10 text-destructive" aria-hidden="true" />
          <div className="flex flex-col gap-1">
            <p className="text-base font-medium">{heading}</p>
            <p className="text-sm text-muted-foreground">{message}</p>
          </div>
          <Button asChild className="w-full">
            <Link href="/login">Go to login</Link>
          </Button>
        </CardContent>
      </Card>
    </FadeIn>
  );
}

const INVALID_INVITE_MESSAGE =
  "This invite link is invalid or has expired. Ask your admin to send a new one.";

async function InvitePage({ searchParams }: InvitePageProps) {
  const { token } = await searchParams;
  if (!token) {
    return <ErrorCard heading="Invite link invalid" message={INVALID_INVITE_MESSAGE} />;
  }

  const invite = await consumeInviteToken(token);
  if (!invite) {
    return <ErrorCard heading="Invite link invalid" message={INVALID_INVITE_MESSAGE} />;
  }

  const company = await db.company.findUnique({
    where: { id: invite.companyId },
    select: { name: true },
  });
  if (!company) {
    return <ErrorCard heading="Invite link invalid" message={INVALID_INVITE_MESSAGE} />;
  }

  const session = await auth();
  const signedInUser = session?.user?.id
    ? await db.user.findUnique({
        where: { id: session.user.id },
        select: { id: true, email: true, companyId: true },
      })
    : null;

  if (signedInUser) {
    if (signedInUser.companyId) {
      return (
        <ErrorCard
          heading="You already belong to a company"
          message="Sign out and open this invite link with a different account to accept it."
        />
      );
    }
    if (signedInUser.email.toLowerCase() !== invite.email.toLowerCase()) {
      return (
        <ErrorCard
          heading="Wrong account"
          message={`This invite was sent to ${invite.email}. Sign out and open the link again signed in as that address.`}
        />
      );
    }

    return (
      <FadeIn>
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Join {company.name} on ResumeRank</CardTitle>
            <CardDescription>
              You&apos;ve been invited to join as {invite.role.toLowerCase()}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <InviteJoinButton inviteId={invite.id} companyName={company.name} />
          </CardContent>
        </Card>
      </FadeIn>
    );
  }

  const existingAccount = await db.user.findUnique({
    where: { email: invite.email },
    select: { id: true },
  });

  if (existingAccount) {
    const next = `/invite?token=${encodeURIComponent(token)}`;
    return (
      <FadeIn>
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Join {company.name} on ResumeRank</CardTitle>
            <CardDescription>
              Log in with {invite.email} to accept this invite.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full">
              <Link href={`/login?next=${encodeURIComponent(next)}`}>
                Log in to continue
              </Link>
            </Button>
          </CardContent>
        </Card>
      </FadeIn>
    );
  }

  return (
    <FadeIn>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Join {company.name} on ResumeRank</CardTitle>
          <CardDescription>
            Create your account to join as {invite.role.toLowerCase()}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <InviteSignupForm token={token} email={invite.email} />
        </CardContent>
      </Card>
    </FadeIn>
  );
}

export default InvitePage;
