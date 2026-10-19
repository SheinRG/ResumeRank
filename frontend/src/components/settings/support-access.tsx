"use client";

import { LifeBuoy, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { useFormat } from "@/components/format/format-provider";
import { EmptyState } from "@/components/shared/empty-state";
import { useStepUp } from "@/components/step-up/step-up-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { setSupportAccessAction } from "@/server/actions/support-access";
import type { SupportAccess, SupportSessionSummary } from "@/server/queries/support-access";
import { SUPPORT_ACCESS_DAYS, supportAccessSchema } from "@resumerank/core/validators/support-access";

const GRANT_OPTIONS = SUPPORT_ACCESS_DAYS.filter((days) => days > 0);

function sessionState(session: SupportSessionSummary, now: number): { label: string; live: boolean } {
  if (session.endedAt) return { label: "Ended", live: false };
  if (new Date(session.expiresAt).getTime() <= now) return { label: "Expired", live: false };
  return { label: "In progress", live: true };
}

export function SupportAccessCard({ access, canChange }: { access: SupportAccess; canChange: boolean }) {
  const format = useFormat();
  const withStepUp = useStepUp();
  const [state, setState] = useState(access);
  const [days, setDays] = useState<string>("7");
  const [isPending, startTransition] = useTransition();
  const [now] = useState(() => Date.now());

  const granted = state.until !== null && new Date(state.until).getTime() > now;

  function save(nextDays: number) {
    const parsed = supportAccessSchema.safeParse({ days: nextDays });
    if (!parsed.success) {
      toast.error("Choose how long support may have access.");
      return;
    }
    startTransition(async () => {
      const result = await withStepUp(() => setSupportAccessAction(parsed.data));
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setState(result.data);
      toast.success(nextDays === 0 ? "Support access withdrawn." : "Support access granted.");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Support access</CardTitle>
        <CardDescription>
          Lets ResumeRank support see the workspace as one of its members, to look into a problem you
          report. They can only look: nothing can be changed, exported or sent in a support session, and
          each one lasts at most an hour. Every session, with the reason given, is listed here and in the
          activity log. Withdrawing access ends any session in progress.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-3">
          {granted && state.until ? (
            <Badge variant="outline" className="border-verdict-strong/40 text-verdict-strong">
              Granted until {format.dateTime(state.until)}
            </Badge>
          ) : (
            <Badge variant="outline">Not granted</Badge>
          )}
        </div>

        {canChange ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="support-access-days">Grant access for</Label>
            <div className="flex flex-wrap items-center gap-3">
              <Select value={days} onValueChange={setDays} disabled={isPending}>
                <SelectTrigger id="support-access-days" className="w-full sm:w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GRANT_OPTIONS.map((option) => (
                    <SelectItem key={option} value={String(option)}>
                      {option} day{option === 1 ? "" : "s"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="button" onClick={() => save(Number(days))} disabled={isPending}>
                {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                {granted ? "Extend access" : "Grant access"}
              </Button>
              {granted ? (
                <Button type="button" variant="outline" onClick={() => save(0)} disabled={isPending}>
                  Withdraw access
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Only an owner can change this.</p>
        )}

        {state.sessions.length === 0 ? (
          <EmptyState
            icon={LifeBuoy}
            title="No support sessions yet"
            description="When ResumeRank support views the workspace, each session shows up here."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Started</TableHead>
                <TableHead>Support</TableHead>
                <TableHead>Viewed as</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {state.sessions.map((session) => {
                const { label, live } = sessionState(session, now);
                return (
                  <TableRow key={session.id}>
                    <TableCell className="whitespace-nowrap">{format.dateTime(session.startedAt)}</TableCell>
                    <TableCell>{session.staffName}</TableCell>
                    <TableCell>{session.targetName}</TableCell>
                    <TableCell className="max-w-xs whitespace-normal text-muted-foreground">{session.reason}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant={live ? "default" : "outline"}>{label}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
