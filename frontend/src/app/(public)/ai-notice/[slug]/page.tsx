import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getPublicAiNotice } from "@/server/queries/compliance";

export const metadata: Metadata = {
  title: "How AI is used in screening",
  robots: { index: false },
};

export default async function AiNoticePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const notice = await getPublicAiNotice(slug);
  if (!notice) notFound();

  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={1} className="text-2xl">How {notice.companyName} uses AI in screening</CardTitle>
        <CardDescription>
          A notice for people applying to {notice.companyName}, under New York City Local Law 144 and the EU
          AI Act.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6 text-sm leading-relaxed text-foreground">
        {notice.customText ? (
          <section className="flex flex-col gap-2 whitespace-pre-line rounded-lg border border-border bg-muted/40 p-4">
            {notice.customText}
          </section>
        ) : null}

        <section className="flex flex-col gap-2">
          <h2 className="font-semibold">What the AI does</h2>
          <p>
            {notice.companyName} uses ResumeRank, an AI tool, to help review applications. For each
            requirement of the job, it reads your resume and says whether the resume shows strong, partial
            or no evidence of it, quoting the passage it relied on. Those verdicts add up to a match score.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="font-semibold">What it looks at</h2>
          <p>
            Only the text of your resume and the job&apos;s title, description and listed requirements, which
            are the qualifications and characteristics it assesses. It doesn&apos;t look at photos, social
            media or anything outside your application.
            {notice.redactsPii
              ? " Your name, contact details, age and other personal attributes are hidden from the AI before it reads your resume."
              : ""}
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="font-semibold">Who decides</h2>
          <p>
            People do. The AI never rejects or advances anyone on its own. A recruiter reads its verdicts,
            can see the evidence behind each one, and makes every decision. Each decision is recorded together
            with what the AI had shown at the time.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="font-semibold">Your choices</h2>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            <li>
              You can ask not to be assessed by AI. Your application is then reviewed by a person only, and
              asking doesn&apos;t count against you.
            </li>
            <li>You can ask what data is held about you, and for it to be corrected or deleted.</li>
            <li>
              You may be invited to answer optional demographic questions. They are used only, in aggregate,
              to check that screening treats every group fairly, and never seen next to your application.
            </li>
          </ul>
          <p>To make a request, reply to the recruiter who contacted you or write to {notice.companyName}&apos;s recruiting team.</p>
        </section>

        <p className="text-muted-foreground">
          How the model is evaluated, and its limits:{" "}
          <Link href="/ai" className="font-medium text-foreground underline underline-offset-4">
            ResumeRank model card
          </Link>
          .
        </p>
      </CardContent>
    </Card>
  );
}
