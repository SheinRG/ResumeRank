"use client";

import { ExternalLink, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useStepUp } from "@/components/step-up/step-up-provider";
import { updateAiPolicyAction } from "@/server/actions/compliance";
import type { AiPolicy } from "@/server/queries/compliance";
import { aiPolicySchema, MAX_NOTICE_LENGTH } from "@resumerank/core/validators/compliance";

export function AiPolicyCard({ policy }: { policy: AiPolicy }) {
  const [aiRedactPii, setRedact] = useState(policy.aiRedactPii);
  const [aiNoticeRequired, setNoticeRequired] = useState(policy.aiNoticeRequired);
  const [aiNoticeText, setNoticeText] = useState(policy.aiNoticeText ?? "");
  const [saved, setSaved] = useState(policy);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const withStepUp = useStepUp();

  const dirty =
    aiRedactPii !== saved.aiRedactPii ||
    aiNoticeRequired !== saved.aiNoticeRequired ||
    aiNoticeText.trim() !== (saved.aiNoticeText ?? "");

  function save() {
    const parsed = aiPolicySchema.safeParse({ aiRedactPii, aiNoticeRequired, aiNoticeText });
    if (!parsed.success) {
      setError(parsed.error.flatten().fieldErrors.aiNoticeText?.[0] ?? "Check the policy.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await withStepUp(() => updateAiPolicyAction(parsed.data));
      if (!result.ok) {
        setError(result.fieldErrors?.aiNoticeText?.[0] ?? null);
        toast.error(result.error);
        return;
      }
      setSaved(result.data);
      setNoticeText(result.data.aiNoticeText ?? "");
      toast.success("AI policy saved. It applies to scores requested from now on.");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI policy</CardTitle>
        <CardDescription>
          How AI screening treats candidates in this workspace. Changes apply to scores requested from
          now on; finished scores keep the inputs they were made from.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex items-center justify-between gap-6">
          <div className="flex flex-col gap-1">
            <Label htmlFor="ai-redact-pii">Hide personal details from the AI</Label>
            <p className="text-sm text-muted-foreground">
              Names, email addresses, phone numbers, profile links, ages, and labelled lines like date of
              birth, gender, nationality or marital status are masked before the resume reaches the model.
              Skills, employers and dates stay.
            </p>
          </div>
          <Switch id="ai-redact-pii" checked={aiRedactPii} disabled={isPending} onCheckedChange={setRedact} />
        </div>

        <div className="flex items-center justify-between gap-6">
          <div className="flex flex-col gap-1">
            <Label htmlFor="ai-notice-required">Require the AI notice before scoring</Label>
            <p className="text-sm text-muted-foreground">
              Scoring refuses a candidate until someone records, on the candidate&apos;s page, that they were
              given the notice. New York City&apos;s Local Law 144 asks for it ten business days before an
              automated tool is used. Candidates who opt out are never scored, whatever this is set to.
            </p>
          </div>
          <Switch
            id="ai-notice-required"
            checked={aiNoticeRequired}
            disabled={isPending}
            onCheckedChange={setNoticeRequired}
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <Label htmlFor="ai-notice-text">Notice to candidates</Label>
            <a
              href={`/ai-notice/${saved.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              View public notice
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          </div>
          <Textarea
            id="ai-notice-text"
            rows={6}
            value={aiNoticeText}
            disabled={isPending}
            onChange={(event) => setNoticeText(event.target.value)}
            placeholder="Leave blank to use the default notice, which explains what the AI reads, that a person makes every decision, and how to opt out."
            aria-invalid={error ? true : undefined}
            aria-describedby="ai-notice-text-hint"
          />
          <p id="ai-notice-text-hint" className={error ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
            {error ?? `Shown on your public notice page above the standard details. Up to ${MAX_NOTICE_LENGTH} characters.`}
          </p>
        </div>

        <div>
          <Button type="button" onClick={save} disabled={!dirty || isPending}>
            {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            {isPending ? "Saving…" : "Save AI policy"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
