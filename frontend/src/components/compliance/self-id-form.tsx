"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";

import { AuthAlert } from "@/components/auth/auth-alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { submitSelfIdAction } from "@/server/actions/compliance";
import { SELF_ID_RACES, SELF_ID_SEXES, selfIdSchema } from "@resumerank/core/validators/compliance";

import { RACE_LABELS, SEX_LABELS } from "./impact-labels";

const DECLINED = "DECLINED";

interface SelfIdFormProps {
  token: string;
  companyName: string;
  jobTitle: string;
  answered: boolean;
}

export function SelfIdForm({ token, companyName, jobTitle, answered }: SelfIdFormProps) {
  const [sex, setSex] = useState("");
  const [race, setRace] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [isPending, startTransition] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = selfIdSchema.safeParse({ token, sex, race });
    if (!parsed.success) {
      setError("Choose an answer for each question, or “Prefer not to say”.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await submitSelfIdAction(parsed.data);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDone(true);
    });
  }

  if (done) {
    return (
      <Card>
        <CardHeader>
          <CheckCircle2 className="size-8 text-verdict-strong" aria-hidden="true" />
          <CardTitle role="heading" aria-level={1} className="text-2xl">Thank you</CardTitle>
          <CardDescription>
            Your answers are saved. They&apos;re used only in aggregate to check that screening at {companyName}{" "}
            treats every group fairly. You can close this page.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={1} className="text-2xl">Voluntary self-identification</CardTitle>
        <CardDescription>
          For your application to {jobTitle} at {companyName}. Answering is optional and doesn&apos;t affect
          your application: the people reviewing it never see your answers, and the AI never reads them.
          They&apos;re only counted, across all applicants, to check that screening treats every group fairly.
          {answered ? " You've answered before; answering again replaces your earlier answers." : ""}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
          {error ? <AuthAlert>{error}</AuthAlert> : null}
          <div className="flex flex-col gap-2">
            <Label htmlFor="self-id-sex">Sex</Label>
            <Select value={sex} onValueChange={setSex} disabled={isPending}>
              <SelectTrigger id="self-id-sex" className="w-full">
                <SelectValue placeholder="Choose an answer" />
              </SelectTrigger>
              <SelectContent>
                {SELF_ID_SEXES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {SEX_LABELS[value]}
                  </SelectItem>
                ))}
                <SelectItem value={DECLINED}>Prefer not to say</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="self-id-race">Race / ethnicity</Label>
            <Select value={race} onValueChange={setRace} disabled={isPending}>
              <SelectTrigger id="self-id-race" className="w-full">
                <SelectValue placeholder="Choose an answer" />
              </SelectTrigger>
              <SelectContent>
                {SELF_ID_RACES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {RACE_LABELS[value]}
                  </SelectItem>
                ))}
                <SelectItem value={DECLINED}>Prefer not to say</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              Categories follow the U.S. EEO-1 report, which bias audits use.
            </p>
          </div>
          <Button type="submit" disabled={isPending}>
            {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            {isPending ? "Saving…" : "Submit answers"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
