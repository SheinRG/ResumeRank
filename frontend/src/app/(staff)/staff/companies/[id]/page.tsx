import type { Metadata } from "next";
import { ArrowLeft, LifeBuoy, Mail, Users } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DateText } from "@/components/format/format-provider";
import { EmptyState } from "@/components/shared/empty-state";
import { StatCard } from "@/components/shared/stat-card";
import { CompanyMembers } from "@/components/staff/company-members";
import { AiBudgetCard, FlagsCard, SuspensionCard, type FlagRow } from "@/components/staff/company-controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireStaff } from "@/lib/auth/guards";
import { ROLE_LABELS } from "@/lib/roles";
import { getCompanyOverview } from "@/server/queries/staff";
import { flagDefinition } from "@resumerank/core/flags/registry";
import { NotFoundError } from "@resumerank/core/services/errors";
import type { CompanyOverview } from "@resumerank/core/staff/companies";

export const metadata: Metadata = { title: "Workspace" };

const PLAN_LABELS = { FREE: "Free", TEAM: "Team", ENTERPRISE: "Enterprise" } as const;

async function loadOverview(id: string): Promise<CompanyOverview> {
  try {
    return await getCompanyOverview(id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="font-mono text-[10.5px] tracking-[0.08em] text-muted-foreground uppercase">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  );
}

function sessionStatus(session: { endedAt: Date | null; expiresAt: Date }, now: Date): string {
  if (session.endedAt) return "Ended";
  return session.expiresAt <= now ? "Expired" : "In progress";
}

export default async function StaffCompanyPage({ params }: PageProps<"/staff/companies/[id]">) {
  const { id } = await params;
  const [actor, overview] = await Promise.all([requireStaff(), loadOverview(id)]);
  const { company, billing, ai, counts } = overview;
  const isAdmin = actor.role === "ADMIN";
  const now = new Date();
  const supportAccess = company.supportAccessUntil !== null && company.supportAccessUntil > now;
  const flags: FlagRow[] = overview.flags.flags.map(({ flag, decision, reason }) => ({
    flag,
    label: flagDefinition(flag).label,
    enabled: decision.enabled,
    source: decision.source,
    reason,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Button asChild variant="ghost" size="sm" className="-ml-3 w-fit">
          <Link href="/staff">
            <ArrowLeft aria-hidden="true" />
            Workspaces
          </Link>
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display-app text-[27px] font-semibold tracking-tight text-foreground">{company.name}</h1>
          {company.suspendedAt ? <Badge variant="destructive">Suspended</Badge> : null}
          <Badge variant="outline">{PLAN_LABELS[billing.plan]}</Badge>
        </div>
        <p className="font-mono text-xs text-muted-foreground">
          {company.slug} · {company.id} · created <DateText value={company.createdAt} />
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Members" value={counts.members} />
        <StatCard label="Jobs" value={counts.jobs} />
        <StatCard label="Candidates" value={counts.candidates} />
        <StatCard label="Applications" value={counts.applications} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>Billing, security settings and recent failures, as of this page load.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            <Fact label="Plan">
              {billing.enabled ? PLAN_LABELS[billing.plan] : "Billing is off"}
              {billing.comped ? " (comped)" : ""}
              {billing.status ? ` · ${billing.status.toLowerCase().replaceAll("_", " ")}` : ""}
            </Fact>
            <Fact label="Seats">{billing.seats ?? "Plan default"}</Fact>
            <Fact label="Past due since">{billing.pastDueSince ? <DateText value={billing.pastDueSince} /> : "—"}</Fact>
            <Fact label="Period ends">
              {billing.currentPeriodEnd ? <DateText value={billing.currentPeriodEnd} /> : "—"}
            </Fact>
            <Fact label="Stripe customer">
              <span className="font-mono text-xs">{billing.stripeCustomerId ?? "—"}</span>
            </Fact>
            <Fact label="Security">
              {[
                company.ssoEnforced ? "SSO required" : null,
                company.mfaRequired ? "2FA required" : null,
                company.ipRanges > 0 ? `${company.ipRanges} allowed network${company.ipRanges === 1 ? "" : "s"}` : null,
              ]
                .filter(Boolean)
                .join(" · ") || "Defaults"}
            </Fact>
            <Fact label="Verified domains">
              {overview.verifiedDomains.length > 0 ? overview.verifiedDomains.join(", ") : "None"}
            </Fact>
            <Fact label="Failed in the last 7 days">
              {counts.failedScoringRuns7d} scoring run{counts.failedScoringRuns7d === 1 ? "" : "s"},{" "}
              {counts.failedResumeFiles7d} resume file{counts.failedResumeFiles7d === 1 ? "" : "s"}
            </Fact>
            <Fact label="Support access">
              {supportAccess && company.supportAccessUntil ? (
                <>
                  Granted until <DateText value={company.supportAccessUntil} kind="dateTime" />
                </>
              ) : (
                "Not granted"
              )}
            </Fact>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>
            {supportAccess
              ? "“View as” opens the workspace as that member, read-only, for up to an hour."
              : "“View as” needs the workspace's support access, which an owner grants in Settings → Security."}
            {counts.members > overview.members.length ? ` Showing the first ${overview.members.length}.` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {overview.members.length === 0 ? (
            <EmptyState icon={Users} title="No members" description="Everyone has left this workspace." />
          ) : (
            <CompanyMembers
              companyId={company.id}
              companyName={company.name}
              members={overview.members}
              supportAccess={supportAccess}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Email</CardTitle>
          <CardDescription>
            The latest messages to members and pending invitees, for “the invite never arrived”. Contents
            aren&apos;t kept once a message is delivered or gives up.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {overview.pendingInvites.length > 0 ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">Pending invites</p>
              <ul className="flex flex-col gap-1 text-sm">
                {overview.pendingInvites.map((invite) => (
                  <li key={invite.email} className="flex flex-wrap gap-x-2">
                    <span className="font-mono text-xs">{invite.email}</span>
                    <span className="text-muted-foreground">
                      as {ROLE_LABELS[invite.role]}, expires <DateText value={invite.expiresAt} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {overview.emails.length === 0 ? (
            <EmptyState icon={Mail} title="No email yet" description="Nothing has been sent to this workspace's people." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>To</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Queued</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overview.emails.map((email) => (
                  <TableRow key={email.id}>
                    <TableCell className="font-mono text-xs">{email.to}</TableCell>
                    <TableCell>{email.kind.toLowerCase().replaceAll("_", " ")}</TableCell>
                    <TableCell>
                      <span className="block">{email.status.toLowerCase()}</span>
                      {email.error ? (
                        <span className="block max-w-xs whitespace-normal text-xs text-muted-foreground">
                          {email.error} (after {email.attempts} attempt{email.attempts === 1 ? "" : "s"})
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <DateText value={email.createdAt} kind="dateTime" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <FlagsCard companyId={company.id} flags={flags} canChange={isAdmin} />

      <div className="grid gap-6 lg:grid-cols-2">
        <AiBudgetCard
          companyId={company.id}
          used={ai.used}
          budget={ai.budget}
          override={company.aiTokenBudget}
          canChange={isAdmin}
        />
        <SuspensionCard
          companyId={company.id}
          companyName={company.name}
          suspendedAt={company.suspendedAt}
          canChange={isAdmin}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Support sessions</CardTitle>
          <CardDescription>The workspace&apos;s owners see these too, with the reasons.</CardDescription>
        </CardHeader>
        <CardContent>
          {overview.supportSessions.length === 0 ? (
            <EmptyState icon={LifeBuoy} title="No support sessions yet" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Started</TableHead>
                  <TableHead>Staff</TableHead>
                  <TableHead>Viewed as</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overview.supportSessions.map((session) => (
                  <TableRow key={session.id}>
                    <TableCell className="whitespace-nowrap">
                      <DateText value={session.startedAt} kind="dateTime" />
                    </TableCell>
                    <TableCell>{session.staffName}</TableCell>
                    <TableCell>{session.targetName}</TableCell>
                    <TableCell className="max-w-xs whitespace-normal text-muted-foreground">{session.reason}</TableCell>
                    <TableCell className="text-right">{sessionStatus(session, now)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <CardTitle>Staff activity here</CardTitle>
            <CardDescription>The latest entries about this workspace in the staff audit log.</CardDescription>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href={`/staff/audit?companyId=${company.id}`}>Full log</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {overview.staffActivity.length === 0 ? (
            <p className="text-sm text-muted-foreground">This is the first time staff have opened this workspace.</p>
          ) : null}
          <ul className="flex flex-col gap-2 text-sm">
            {overview.staffActivity.map((entry) => (
              <li key={entry.id} className="flex flex-wrap gap-x-2">
                <span className="font-mono text-xs text-muted-foreground">
                  <DateText value={entry.createdAt} kind="dateTime" />
                </span>
                <span className="font-medium">{entry.staffEmail}</span>
                <span>{entry.summary}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
