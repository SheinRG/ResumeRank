import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { History } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ActivityFilter } from "@/components/activity/activity-filter";
import { PaginationControl } from "@/components/shared/pagination-control";
import { formatCount, formatDate, formatRelative, initials } from "@/lib/format";
import { cursorParamSchema } from "@resumerank/core/validators/search";
import { listActivity, type ActivityEntityType } from "@/server/queries/activity";

export const metadata: Metadata = { title: "Activity" };

const ENTITY_VALUES = ["all", "job", "candidate", "application", "user"] as const;
const searchParamsSchema = z.object({
  entity: z.enum(ENTITY_VALUES).catch("all"),
  after: cursorParamSchema,
  before: cursorParamSchema,
});

const ENTITY_LABELS: Record<ActivityEntityType, string> = {
  job: "Job",
  candidate: "Candidate",
  application: "Application",
  user: "User",
};

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const parsed = searchParamsSchema.parse({
    entity: typeof raw.entity === "string" ? raw.entity : undefined,
    after: typeof raw.after === "string" ? raw.after : undefined,
    before: typeof raw.before === "string" ? raw.before : undefined,
  });

  const entityType = parsed.entity === "all" ? undefined : parsed.entity;
  const result = await listActivity({ entityType, after: parsed.after, before: parsed.before });
  const hasFilter = parsed.entity !== "all";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Activity"
        description="An append-only log of changes across your workspace."
      />

      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <ActivityFilter value={parsed.entity} />
            {result.total > 0 ? (
              <p className="text-sm text-muted-foreground">
                {formatCount(result, "event")}
              </p>
            ) : null}
          </div>

          {result.items.length === 0 ? (
            <EmptyState
              icon={History}
              title={hasFilter ? "No matches for this filter" : "No activity yet"}
              description={
                hasFilter
                  ? "Try a different entity type, or clear the filter to see everything."
                  : "Actions your team takes will show up here."
              }
              action={
                hasFilter ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href="/activity">Clear filter</Link>
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Actor</TableHead>
                    <TableHead>Summary</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead className="text-right">When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar className="size-7">
                            {item.actor.image ? (
                              <AvatarImage src={item.actor.image} alt="" />
                            ) : null}
                            <AvatarFallback className="text-[10px]">
                              {initials(item.actor.name)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium text-foreground">
                            {item.actor.name}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-md truncate text-foreground">
                        {item.summary}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {ENTITY_LABELS[item.entityType as ActivityEntityType] ??
                            item.entityType}
                        </Badge>
                      </TableCell>
                      <TableCell
                        className="text-right text-muted-foreground"
                        title={formatDate(item.createdAt)}
                      >
                        {formatRelative(item.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <PaginationControl nextCursor={result.nextCursor} prevCursor={result.prevCursor} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
