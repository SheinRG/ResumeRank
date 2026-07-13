"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { STAGE_LABELS, ScorePill, StageBadge } from "@/components/shared/status-badges";
import { formatDate } from "@/lib/format";
import { STAGES } from "@resumerank/core/validators/enums";
import type { Stage } from "@resumerank/core/validators/enums";
import { updateStageAction } from "@/server/actions/applications";
import type { ApplicationListItem } from "@/server/queries/applications";

export function ApplicantsTable({
  items,
  canWrite,
}: {
  items: ApplicationListItem[];
  canWrite: boolean;
}) {
  // Optimistic stage per application id, layered over the server-provided
  // items so URL-driven refetches (filters, pagination) always win.
  const [stageOverrides, setStageOverrides] = useState<Record<string, Stage>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const rows = items.map((item) => ({
    ...item,
    stage: stageOverrides[item.id] ?? item.stage,
  }));

  function handleStageChange(applicationId: string, stage: Stage) {
    setStageOverrides((current) => ({ ...current, [applicationId]: stage }));
    setPendingId(applicationId);
    startTransition(async () => {
      const result = await updateStageAction({ id: applicationId, stage });
      setPendingId(null);
      if (!result.ok) {
        setStageOverrides((current) => {
          const next = { ...current };
          delete next[applicationId];
          return next;
        });
        toast.error(result.error);
        return;
      }
      toast.success(`Moved to ${STAGE_LABELS[stage]}.`);
    });
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Candidate</TableHead>
          <TableHead>Score</TableHead>
          <TableHead>Stage</TableHead>
          <TableHead className="text-right">Applied</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="whitespace-normal">
              <Link
                href={`/applications/${row.id}`}
                className="font-medium text-foreground outline-none hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {row.candidate.name}
              </Link>
              <p className="text-xs text-muted-foreground">{row.candidate.email}</p>
            </TableCell>
            <TableCell>
              <ScorePill score={row.aiScore} />
            </TableCell>
            <TableCell>
              {canWrite ? (
                <Select
                  value={row.stage}
                  disabled={pendingId === row.id}
                  onValueChange={(value) => handleStageChange(row.id, value as Stage)}
                >
                  <SelectTrigger
                    size="sm"
                    className="w-40"
                    aria-label={`Change ${row.candidate.name}'s stage`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STAGES.map((stage) => (
                      <SelectItem key={stage} value={stage}>
                        {STAGE_LABELS[stage]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <StageBadge stage={row.stage} />
              )}
            </TableCell>
            <TableCell className="text-right text-muted-foreground">
              {formatDate(row.createdAt)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
