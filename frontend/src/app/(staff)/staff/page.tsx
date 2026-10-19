import type { Metadata } from "next";
import { Building2, Search } from "lucide-react";
import Link from "next/link";

import { DateText } from "@/components/format/format-provider";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { findCompanies } from "@/server/queries/staff";
import { staffSearchSchema } from "@resumerank/core/validators/staff";

export const metadata: Metadata = { title: "Workspaces" };

const PLAN_LABELS = { FREE: "Free", TEAM: "Team", ENTERPRISE: "Enterprise" } as const;

export default async function StaffSearchPage({ searchParams }: PageProps<"/staff">) {
  const raw = await searchParams;
  const parsed = staffSearchSchema.safeParse({ q: typeof raw.q === "string" ? raw.q : undefined });
  const q = parsed.success ? parsed.data.q : "";
  const companies = await findCompanies(q);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Workspaces"
        description="Find a workspace by its name, slug or id, a verified domain, or a member's email. Searches are recorded in the staff audit log."
      />

      <Card>
        <CardContent className="flex flex-col gap-4">
          <form action="/staff" method="get" role="search" className="flex flex-col gap-2 sm:flex-row">
            <label htmlFor="staff-search" className="sr-only">
              Search workspaces
            </label>
            <Input
              id="staff-search"
              name="q"
              type="search"
              defaultValue={q}
              maxLength={200}
              placeholder="acme, acme.com, ada@acme.com…"
              className="sm:max-w-md"
            />
            <Button type="submit" variant="outline">
              <Search aria-hidden="true" />
              Search
            </Button>
          </form>
          {!parsed.success ? (
            <p className="text-sm text-destructive">{parsed.error.issues[0]?.message}</p>
          ) : null}

          {companies.length === 0 ? (
            <EmptyState
              icon={Building2}
              title={q ? `No workspace matches "${q}"` : "No workspaces yet"}
              description={
                q
                  ? "Try the company's slug, a domain it has verified, or a member's full email address."
                  : "Workspaces appear here as soon as someone registers."
              }
              action={
                q ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href="/staff">Clear the search</Link>
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {q ? `Best matches for "${q}", newest first.` : "The newest workspaces."} Showing up to 25.
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Workspace</TableHead>
                    <TableHead>Slug</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead className="text-right">Members</TableHead>
                    <TableHead className="text-right">Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {companies.map((company) => (
                    <TableRow key={company.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/staff/companies/${company.id}`}
                            className="font-medium text-foreground outline-none hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring/50"
                          >
                            {company.name}
                          </Link>
                          {company.suspendedAt ? <Badge variant="destructive">Suspended</Badge> : null}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{company.slug}</TableCell>
                      <TableCell>{company.plan ? PLAN_LABELS[company.plan] : "—"}</TableCell>
                      <TableCell className="text-right font-mono">{company.members}</TableCell>
                      <TableCell className="text-right">
                        <DateText value={company.createdAt} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
