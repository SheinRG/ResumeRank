import { db } from "../db";
import { getAiBudget, type AiBudget } from "../ai-budget";
import { logActivity } from "../activity";
import { BILLING_STATE_SELECT, billingPlan, effectivePlan } from "../billing/account";
import type { Plan } from "../billing/plans";
import { isBillingEnabled } from "../env";
import { describeCompanyFlags, type CompanyFlagReport } from "../flags/overrides";
import type { Prisma } from "../generated/prisma/client";
import type { EmailStatus, Role, SubscriptionStatus } from "../generated/prisma/enums";
import { NotFoundError } from "../services/errors";
import type { AiBudgetOverrideInput, SuspensionInput } from "../validators/staff";
import { assertStaffRole, auditorOf, logStaffAction, type StaffActor } from "./actor";

const SEARCH_LIMIT = 25;
const MEMBER_LIMIT = 200;
const RECENT_EMAILS = 20;
const RECENT_SUPPORT_SESSIONS = 10;
const RECENT_STAFF_ENTRIES = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface CompanySearchResult {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  suspendedAt: Date | null;
  members: number;
  /** Null while billing is off. */
  plan: Plan | null;
}

function searchWhere(q: string): Prisma.CompanyWhereInput {
  if (!q) return {};
  const lowered = q.toLowerCase();
  return {
    OR: [
      { id: q },
      { slug: { contains: lowered } },
      { name: { contains: q, mode: "insensitive" } },
      { domains: { some: { domain: lowered, verifiedAt: { not: null } } } },
      { memberships: { some: { user: { email: { contains: lowered } } } } },
    ],
  };
}

/**
 * Finds workspaces by name, slug, id, verified domain or a member's email,
 * across every tenant on purpose: this is how support finds the one a ticket
 * is about. With no query, the newest. Each search is recorded.
 */
export async function searchCompanies(actor: StaffActor, q: string): Promise<CompanySearchResult[]> {
  const rows = await db.company.findMany({
    where: searchWhere(q),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: SEARCH_LIMIT,
    select: {
      id: true,
      name: true,
      slug: true,
      createdAt: true,
      suspendedAt: true,
      billingAccount: { select: BILLING_STATE_SELECT },
      _count: { select: { memberships: true } },
    },
  });
  if (q) {
    await logStaffAction(auditorOf(actor), {
      action: "staff.search",
      summary: `searched workspaces for "${q}"`,
      metadata: { q, results: rows.length },
    });
  }
  return rows.map(({ billingAccount, _count, ...company }) => ({
    ...company,
    members: _count.memberships,
    plan: billingPlan(billingAccount),
  }));
}

export interface StaffMemberRow {
  userId: string;
  name: string;
  email: string;
  role: Role;
  emailVerified: boolean;
  hasSecondFactor: boolean;
  lastSeenAt: Date | null;
  joinedAt: Date;
  suppressed: boolean;
}

export interface StaffEmailRow {
  id: string;
  to: string;
  kind: string;
  status: EmailStatus;
  attempts: number;
  error: string | null;
  createdAt: Date;
  sentAt: Date | null;
}

export interface StaffSupportSessionRow {
  id: string;
  staffName: string;
  targetName: string;
  reason: string;
  startedAt: Date;
  expiresAt: Date;
  endedAt: Date | null;
}

export interface StaffAuditRow {
  id: string;
  staffEmail: string;
  action: string;
  summary: string;
  createdAt: Date;
}

export interface CompanyOverview {
  company: {
    id: string;
    name: string;
    slug: string;
    website: string | null;
    createdAt: Date;
    suspendedAt: Date | null;
    supportAccessUntil: Date | null;
    aiTokenBudget: number | null;
    ssoEnforced: boolean;
    mfaRequired: boolean;
    ipRanges: number;
  };
  billing: {
    enabled: boolean;
    plan: Plan;
    status: SubscriptionStatus | null;
    seats: number | null;
    comped: boolean;
    pastDueSince: Date | null;
    currentPeriodEnd: Date | null;
    stripeCustomerId: string | null;
  };
  ai: AiBudget;
  counts: {
    members: number;
    pendingInvites: number;
    jobs: number;
    candidates: number;
    applications: number;
    failedScoringRuns7d: number;
    failedResumeFiles7d: number;
  };
  verifiedDomains: string[];
  members: StaffMemberRow[];
  pendingInvites: Array<{ email: string; role: Role; expiresAt: Date }>;
  emails: StaffEmailRow[];
  flags: CompanyFlagReport;
  supportSessions: StaffSupportSessionRow[];
  staffActivity: StaffAuditRow[];
}

async function companyRow(companyId: string) {
  const company = await db.company.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      name: true,
      slug: true,
      website: true,
      createdAt: true,
      suspendedAt: true,
      supportAccessUntil: true,
      aiTokenBudget: true,
      ssoEnforced: true,
      mfaRequired: true,
      _count: { select: { ipAllowlist: true } },
      billingAccount: {
        select: { ...BILLING_STATE_SELECT, currentPeriodEnd: true, stripeCustomerId: true },
      },
    },
  });
  if (!company) throw new NotFoundError("No workspace has that id.");
  return company;
}

/**
 * Everything support needs to answer a ticket about one workspace, read
 * across its tables on the owner connection. It leaves out candidates,
 * resumes and scores: looking at those needs a support session the
 * workspace has agreed to. Each view is recorded.
 */
export async function companyOverview(actor: StaffActor, companyId: string, now = new Date()): Promise<CompanyOverview> {
  const company = await companyRow(companyId);
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);

  const [memberships, memberCount, invites, jobs, candidates, applications, failedRuns, failedFiles, domains] =
    await Promise.all([
      db.membership.findMany({
        where: { companyId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: MEMBER_LIMIT,
        select: {
          role: true,
          createdAt: true,
          user: { select: { id: true, name: true, email: true, emailVerified: true, mfaEnabledAt: true } },
        },
      }),
      db.membership.count({ where: { companyId } }),
      db.companyInvite.findMany({
        where: { companyId, acceptedAt: null, expiresAt: { gt: now } },
        orderBy: { createdAt: "desc" },
        select: { email: true, role: true, expiresAt: true },
      }),
      db.job.count({ where: { companyId } }),
      db.candidate.count({ where: { companyId } }),
      db.application.count({ where: { companyId } }),
      db.scoringRun.count({ where: { companyId, status: "FAILED", createdAt: { gte: weekAgo } } }),
      db.resumeFile.count({ where: { companyId, status: "FAILED", createdAt: { gte: weekAgo } } }),
      db.companyDomain.findMany({
        where: { companyId, verifiedAt: { not: null } },
        orderBy: { domain: "asc" },
        select: { domain: true },
      }),
    ]);

  const userIds = memberships.map((membership) => membership.user.id);
  const addresses = [...memberships.map((membership) => membership.user.email), ...invites.map((invite) => invite.email)];
  const [lastSeen, suppressions, emails, ai, flags, supportSessions, staffActivity] = await Promise.all([
    db.loginSession.groupBy({ by: ["userId"], where: { userId: { in: userIds } }, _max: { lastSeenAt: true } }),
    db.emailSuppression.findMany({ where: { email: { in: addresses } }, select: { email: true } }),
    db.emailMessage.findMany({
      where: { to: { in: addresses } },
      orderBy: { createdAt: "desc" },
      take: RECENT_EMAILS,
      select: { id: true, to: true, kind: true, status: true, attempts: true, error: true, createdAt: true, sentAt: true },
    }),
    getAiBudget(companyId),
    describeCompanyFlags(company.slug),
    db.supportSession.findMany({
      where: { companyId },
      orderBy: { startedAt: "desc" },
      take: RECENT_SUPPORT_SESSIONS,
      select: {
        id: true,
        staffName: true,
        targetName: true,
        reason: true,
        startedAt: true,
        expiresAt: true,
        endedAt: true,
      },
    }),
    db.staffAuditEntry.findMany({
      where: { companyId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: RECENT_STAFF_ENTRIES,
      select: { id: true, staffEmail: true, action: true, summary: true, createdAt: true },
    }),
  ]);
  const seen = new Map(lastSeen.map((row) => [row.userId, row._max.lastSeenAt]));
  const suppressed = new Set(suppressions.map((row) => row.email));

  await logStaffAction(auditorOf(actor), {
    action: "staff.view_company",
    summary: `viewed ${company.name}`,
    companyId,
  });

  const account = company.billingAccount;
  return {
    company: {
      id: company.id,
      name: company.name,
      slug: company.slug,
      website: company.website,
      createdAt: company.createdAt,
      suspendedAt: company.suspendedAt,
      supportAccessUntil: company.supportAccessUntil,
      aiTokenBudget: company.aiTokenBudget,
      ssoEnforced: company.ssoEnforced,
      mfaRequired: company.mfaRequired,
      ipRanges: company._count.ipAllowlist,
    },
    billing: {
      enabled: isBillingEnabled(),
      plan: effectivePlan(account, now),
      status: account?.status ?? null,
      seats: account?.seats ?? null,
      comped: account?.comped ?? false,
      pastDueSince: account?.pastDueSince ?? null,
      currentPeriodEnd: account?.currentPeriodEnd ?? null,
      stripeCustomerId: account?.stripeCustomerId ?? null,
    },
    ai,
    counts: {
      members: memberCount,
      pendingInvites: invites.length,
      jobs,
      candidates,
      applications,
      failedScoringRuns7d: failedRuns,
      failedResumeFiles7d: failedFiles,
    },
    verifiedDomains: domains.map((row) => row.domain),
    members: memberships.map(({ role, createdAt, user }) => ({
      userId: user.id,
      name: user.name,
      email: user.email,
      role,
      emailVerified: user.emailVerified !== null,
      hasSecondFactor: user.mfaEnabledAt !== null,
      lastSeenAt: seen.get(user.id) ?? null,
      joinedAt: createdAt,
      suppressed: suppressed.has(user.email),
    })),
    pendingInvites: invites,
    emails,
    flags,
    supportSessions,
    staffActivity,
  };
}

export interface SuspensionState {
  companyId: string;
  suspendedAt: Date | null;
}

/**
 * Suspending stops anyone opening the workspace and refuses its API keys
 * and directory; nothing is deleted, so lifting it restores everything as it
 * was. Staff can still look at it.
 */
export async function setSuspension(actor: StaffActor, input: SuspensionInput, now = new Date()): Promise<SuspensionState> {
  assertStaffRole(actor, "ADMIN");
  const company = await companyRow(input.companyId);
  if ((company.suspendedAt !== null) === input.suspended) {
    return { companyId: company.id, suspendedAt: company.suspendedAt };
  }

  return db.$transaction(async (tx) => {
    const updated = await tx.company.update({
      where: { id: company.id },
      data: { suspendedAt: input.suspended ? now : null },
      select: { id: true, suspendedAt: true },
    });
    await logActivity(
      {
        companyId: company.id,
        actorId: null,
        action: input.suspended ? "company.suspend" : "company.unsuspend",
        entityType: "company",
        entityId: company.id,
        summary: input.suspended ? "suspended this workspace" : "lifted this workspace's suspension",
      },
      tx,
    );
    await logStaffAction(
      auditorOf(actor),
      {
        action: input.suspended ? "staff.suspend" : "staff.unsuspend",
        summary: `${input.suspended ? "suspended" : "lifted the suspension of"} ${company.name}`,
        companyId: company.id,
        metadata: { reason: input.reason },
      },
      tx,
    );
    return { companyId: updated.id, suspendedAt: updated.suspendedAt };
  });
}

/** Overrides the plan's AI budget for one workspace, or returns it to the plan with null. */
export async function setAiBudgetOverride(actor: StaffActor, input: AiBudgetOverrideInput): Promise<AiBudget> {
  assertStaffRole(actor, "ADMIN");
  const company = await companyRow(input.companyId);
  if (company.aiTokenBudget !== input.budget) {
    await db.$transaction(async (tx) => {
      await tx.company.update({ where: { id: company.id }, data: { aiTokenBudget: input.budget } });
      const summary =
        input.budget === null
          ? "returned the AI budget to the plan's"
          : `set the AI budget to ${input.budget.toLocaleString("en-US")} tokens per 30 days`;
      await logActivity(
        {
          companyId: company.id,
          actorId: null,
          action: "company.ai_budget",
          entityType: "company",
          entityId: company.id,
          summary,
          metadata: { budget: input.budget, previous: company.aiTokenBudget },
        },
        tx,
      );
      await logStaffAction(
        auditorOf(actor),
        {
          action: "staff.ai_budget",
          summary: `${summary} for ${company.name}`,
          companyId: company.id,
          metadata: { budget: input.budget, previous: company.aiTokenBudget, reason: input.reason },
        },
        tx,
      );
    });
  }
  return getAiBudget(company.id);
}

/** For staff code that acts on one workspace's member: the member must belong to it. */
export async function staffCompanyMember(
  companyId: string,
  userId: string,
): Promise<{ company: { id: string; name: string }; user: { id: string; name: string; email: string }; role: Role }> {
  const membership = await db.membership.findUnique({
    where: { userId_companyId: { userId, companyId } },
    select: {
      role: true,
      company: { select: { id: true, name: true } },
      user: { select: { id: true, name: true, email: true } },
    },
  });
  if (!membership) throw new NotFoundError("That person isn't a member of this workspace.");
  return membership;
}
