import type { Metadata } from "next";
import { Download, UserPlus, Users } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { CandidateSourceBadge } from "@/components/shared/status-badges";
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
import { CandidateToolbar } from "@/components/candidates/candidate-toolbar";
import { PaginationControl } from "@/components/shared/pagination-control";
import { formatDate } from "@/lib/format";
import { canWrite, requireUser } from "@/lib/auth/guards";
import { candidateListParamsSchema, type CandidateListParams } from "@resumerank/core/validators/search";
import { listCandidates } from "@/server/queries/candidates";

export const metadata: Metadata = { title: "Candidates" };

function buildExportHref(params: CandidateListParams): string {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.source) query.set("source", params.source);
  if (params.sort !== "newest") query.set("sort", params.sort);
  const qs = query.toString();
  return qs ? `/candidates/export?${qs}` : "/candidates/export";
}

export default async function CandidatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const params = candidateListParamsSchema.parse({
    q: typeof raw.q === "string" ? raw.q : undefined,
    source: typeof raw.source === "string" ? raw.source : undefined,
    sort: typeof raw.sort === "string" ? raw.sort : undefined,
    page: typeof raw.page === "string" ? raw.page : undefined,
  });

  const [user, result] = await Promise.all([requireUser(), listCandidates(params)]);
  const writer = canWrite(user.role);
  const hasFilters = params.q !== "" || params.source !== undefined;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Candidates"
        description="Everyone you've added, across every job."
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href={buildExportHref(params)}>
                <Download aria-hidden="true" />
                Export CSV
              </Link>
            </Button>
            {writer ? (
              <Button asChild size="sm">
                <Link href="/candidates/new">
                  <UserPlus aria-hidden="true" />
                  New candidate
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <CandidateToolbar q={params.q} source={params.source} sort={params.sort} />
            {result.total > 0 ? (
              <p className="shrink-0 text-sm text-muted-foreground">
                {result.total} candidate{result.total === 1 ? "" : "s"}
              </p>
            ) : null}
          </div>

          {result.items.length === 0 ? (
            <EmptyState
              icon={hasFilters ? undefined : Users}
              title={hasFilters ? "No matches for these filters" : "No candidates yet"}
              description={
                hasFilters
                  ? "Try a different search or source, or clear the filters."
                  : writer
                    ? "Add a candidate by pasting their resume text to start screening."
                    : "Candidates your team adds will show up here."
              }
              action={
                hasFilters ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href="/candidates">Clear filters</Link>
                  </Button>
                ) : writer ? (
                  <Button asChild size="sm">
                    <Link href="/candidates/new">
                      <UserPlus aria-hidden="true" />
                      New candidate
                    </Link>
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Headline</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead className="text-right">Applications</TableHead>
                    <TableHead className="text-right">Added</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.items.map((candidate) => (
                    <TableRow key={candidate.id}>
                      <TableCell>
                        <Link
                          href={`/candidates/${candidate.id}`}
                          className="font-medium text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:rounded-sm"
                        >
                          {candidate.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{candidate.email}</TableCell>
                      <TableCell className="max-w-xs truncate text-muted-foreground">
                        {candidate.headline ?? "—"}
                      </TableCell>
                      <TableCell>
                        <CandidateSourceBadge source={candidate.source} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-foreground">
                        {candidate.applicationCount}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {formatDate(candidate.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <PaginationControl page={result.page} pageCount={result.pageCount} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
