import type { Metadata } from "next";
import { ScrollText } from "lucide-react";
import Link from "next/link";

import { DateText } from "@/components/format/format-provider";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getStaffAudit } from "@/server/queries/staff";
import { staffAuditPageSchema } from "@resumerank/core/validators/staff";

export const metadata: Metadata = { title: "Staff audit log" };

function pageHref(cursor: string, companyId: string | undefined): string {
  const query = new URLSearchParams({ cursor });
  if (companyId) query.set("companyId", companyId);
  return `/staff/audit?${query.toString()}`;
}

export default async function StaffAuditPage({ searchParams }: PageProps<"/staff/audit">) {
  const raw = await searchParams;
  const parsed = staffAuditPageSchema.safeParse({
    cursor: typeof raw.cursor === "string" ? raw.cursor : undefined,
    companyId: typeof raw.companyId === "string" ? raw.companyId : undefined,
  });
  const input = parsed.success ? parsed.data : {};
  const page = await getStaffAudit(input);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Staff audit log"
        description="Everything staff have done and looked at, newest first, in UTC. Nobody can edit or delete it, staff included."
        actions={
          input.companyId ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/staff/audit">Every workspace</Link>
            </Button>
          ) : null
        }
      />
      <Card>
        <CardContent className="flex flex-col gap-4">
          {page.items.length === 0 ? (
            <EmptyState
              icon={ScrollText}
              title="Nothing recorded yet"
              description="Searches, workspace views and every change staff make show up here."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Staff</TableHead>
                  <TableHead>What</TableHead>
                  <TableHead>Workspace</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.items.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap font-mono text-xs">
                      <DateText value={entry.createdAt} kind="dateTime" />
                    </TableCell>
                    <TableCell>
                      <span className="block">{entry.staffEmail}</span>
                      {entry.ipAddress ? (
                        <span className="block font-mono text-xs text-muted-foreground">{entry.ipAddress}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <span className="block">{entry.summary}</span>
                      <span className="block font-mono text-xs text-muted-foreground">{entry.action}</span>
                    </TableCell>
                    <TableCell>
                      {entry.companyId ? (
                        <Link
                          href={`/staff/companies/${entry.companyId}`}
                          className="rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
                        >
                          {entry.companyName ?? "Deleted workspace"}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {page.nextCursor ? (
            <div>
              <Button asChild variant="outline" size="sm">
                <Link href={pageHref(page.nextCursor, input.companyId)}>Older entries</Link>
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
