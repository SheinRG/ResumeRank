"use client";

import { Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useFormat } from "@/components/format/format-provider";
import { verifyAuditLogAction } from "@/server/actions/audit";
import type { AuditChainReport } from "@/server/queries/audit";
import { describeChainBreak } from "@resumerank/core/audit/chain";

function ReportResult({ report }: { report: AuditChainReport }) {
  const format = useFormat();
  if (report.fault) {
    return (
      <div role="status" className="flex items-start gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 p-4">
        <ShieldAlert className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
        <div className="flex flex-col gap-1 text-sm">
          <p className="font-medium text-foreground">The audit log has been tampered with.</p>
          <p className="text-foreground">{describeChainBreak(report.fault)}</p>
          <p className="text-muted-foreground">
            {format.number(report.checked)} {report.checked === 1 ? "entry" : "entries"} before it check out. Keep an
            export from before the break, and treat the database as compromised.
          </p>
        </div>
      </div>
    );
  }

  if (report.checked === 0) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        There are no entries to check yet.
      </p>
    );
  }

  return (
    <div role="status" className="flex items-start gap-3 rounded-2xl border border-verdict-strong/40 bg-verdict-strong/10 p-4">
      <ShieldCheck className="mt-0.5 size-5 shrink-0 text-verdict-strong" aria-hidden="true" />
      <div className="flex flex-col gap-1 text-sm">
        <p className="font-medium text-foreground">
          All {format.number(report.checked)} {report.checked === 1 ? "entry" : "entries"} check out.
        </p>
        <p className="text-muted-foreground">
          <span className="font-mono">
            #{report.firstSeq}–#{report.lastSeq}
          </span>{" "}
          · checked {format.date(report.checkedAt)}
          {report.firstSeq !== null && report.firstSeq > 1
            ? ". Older entries were removed by the retention policy."
            : "."}
        </p>
      </div>
    </div>
  );
}

export function AuditIntegrity({ latestSeq }: { latestSeq: number | null }) {
  const [report, setReport] = useState<AuditChainReport | null>(null);
  const [isPending, startTransition] = useTransition();

  function verify() {
    startTransition(async () => {
      const result = await verifyAuditLogAction();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setReport(result.data);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Integrity</CardTitle>
        <CardDescription>
          The database refuses to edit entries, or to delete them other than by the retention policy. Each
          entry is also hash-chained to the one before it, so a change made by going around the database
          shows up here.
          {latestSeq !== null ? (
            <>
              {" "}
              The log is at entry <span className="font-mono">#{latestSeq}</span>.
            </>
          ) : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {report ? <ReportResult report={report} /> : null}
        <div>
          <Button type="button" variant="outline" onClick={verify} disabled={isPending}>
            {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
            {isPending ? "Checking every entry…" : report ? "Check again" : "Verify integrity"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
