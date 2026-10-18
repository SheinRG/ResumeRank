import type { Metadata } from "next";

import { SelfIdForm } from "@/components/compliance/self-id-form";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSelfIdInvite } from "@/server/queries/compliance";

export const metadata: Metadata = {
  title: "Voluntary self-identification",
  robots: { index: false },
};

export default async function SelfIdPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await getSelfIdInvite(decodeURIComponent(token));

  if (!invite) {
    return (
      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={1} className="text-2xl">This link isn&apos;t valid</CardTitle>
          <CardDescription>
            It may have been copied incompletely, or the application was withdrawn. Ask the recruiter who
            sent it for a new link.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <SelfIdForm
      token={decodeURIComponent(token)}
      companyName={invite.companyName}
      jobTitle={invite.jobTitle}
      answered={invite.answered}
    />
  );
}
