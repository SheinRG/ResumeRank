"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatDate } from "@/lib/format";
import { setCandidateAiFlagsAction } from "@/server/actions/compliance";
import { candidateAiFlagsSchema } from "@resumerank/core/validators/compliance";

interface CandidateAiCardProps {
  candidateId: string;
  aiNoticeAt: Date | null;
  aiOptOutAt: Date | null;
  canManage: boolean;
}

export function CandidateAiCard({ candidateId, aiNoticeAt, aiOptOutAt, canManage }: CandidateAiCardProps) {
  const [flags, setFlags] = useState({ aiNoticeAt, aiOptOutAt });
  const [isPending, startTransition] = useTransition();

  function save(next: { noticeGiven: boolean; optedOut: boolean }) {
    const parsed = candidateAiFlagsSchema.safeParse({ id: candidateId, ...next });
    if (!parsed.success) return;
    startTransition(async () => {
      const result = await setCandidateAiFlagsAction(parsed.data);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setFlags({ aiNoticeAt: result.data.aiNoticeAt, aiOptOutAt: result.data.aiOptOutAt });
      toast.success("Saved.");
    });
  }

  const noticeGiven = flags.aiNoticeAt !== null;
  const optedOut = flags.aiOptOutAt !== null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI screening</CardTitle>
        <CardDescription>
          {optedOut
            ? "This candidate opted out, so AI never scores them. Review their applications yourself."
            : "Whether this candidate was told AI helps screen applications, and whether they opted out."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex items-center justify-between gap-6">
          <div className="flex flex-col gap-1">
            <Label htmlFor="candidate-ai-notice">Given the AI notice</Label>
            <p className="text-sm text-muted-foreground">
              {flags.aiNoticeAt ? `Recorded ${formatDate(flags.aiNoticeAt)}.` : "Not recorded."}
            </p>
          </div>
          <Switch
            id="candidate-ai-notice"
            checked={noticeGiven}
            disabled={!canManage || isPending}
            onCheckedChange={(checked) => save({ noticeGiven: checked, optedOut })}
          />
        </div>
        <div className="flex items-center justify-between gap-6">
          <div className="flex flex-col gap-1">
            <Label htmlFor="candidate-ai-opt-out">Opted out of AI scoring</Label>
            <p className="text-sm text-muted-foreground">
              {flags.aiOptOutAt
                ? `Since ${formatDate(flags.aiOptOutAt)}. Queued scores are cancelled.`
                : "Earlier scores stay on record; new ones are refused once this is on."}
            </p>
          </div>
          <Switch
            id="candidate-ai-opt-out"
            checked={optedOut}
            disabled={!canManage || isPending}
            onCheckedChange={(checked) => save({ noticeGiven, optedOut: checked })}
          />
        </div>
      </CardContent>
    </Card>
  );
}
