import { Prisma } from "../generated/prisma/client";
import { accessScope, can } from "../auth/roles";
import type { TenantContext } from "./context";

/**
 * Which of the workspace's jobs the actor reaches. Recruiters, admins and
 * viewers see every job; hiring managers and interviewers only the jobs
 * they're on the hiring team of, or that are filed under one of their
 * departments. Everything else a restricted role sees (applications,
 * candidates, scores) hangs off these jobs, and a job outside them must
 * behave exactly like one that doesn't exist.
 */
function seesWholeCompany(ctx: TenantContext): boolean {
  return accessScope(ctx.role) === "company";
}

export function jobAccessWhere(ctx: TenantContext): Prisma.JobWhereInput {
  if (seesWholeCompany(ctx)) return {};
  return {
    OR: [
      { assignments: { some: { userId: ctx.actorId, companyId: ctx.companyId } } },
      { department: { members: { some: { userId: ctx.actorId, companyId: ctx.companyId } } } },
    ],
  };
}

export function applicationAccessWhere(ctx: TenantContext): Prisma.ApplicationWhereInput {
  return seesWholeCompany(ctx) ? {} : { job: jobAccessWhere(ctx) };
}

/** A candidate is visible to a restricted role through a live application on one of its jobs. */
export function candidateAccessWhere(ctx: TenantContext): Prisma.CandidateWhereInput {
  if (seesWholeCompany(ctx)) return {};
  return { applications: { some: { deletedAt: null, job: jobAccessWhere(ctx) } } };
}

/** `jobAccessWhere` for raw SQL: a predicate over the job id in `jobId`. */
export function jobAccessSql(ctx: TenantContext, jobId: Prisma.Sql): Prisma.Sql {
  if (seesWholeCompany(ctx)) return Prisma.sql`TRUE`;
  return Prisma.sql`(
    EXISTS (
      SELECT 1 FROM "JobAssignment" ja
      WHERE ja."jobId" = ${jobId} AND ja."userId" = ${ctx.actorId} AND ja."companyId" = ${ctx.companyId}
    )
    OR EXISTS (
      SELECT 1 FROM "Job" j
      JOIN "DepartmentMember" dm ON dm."departmentId" = j."departmentId"
      WHERE j."id" = ${jobId} AND dm."userId" = ${ctx.actorId} AND dm."companyId" = ${ctx.companyId}
    )
  )`;
}

/** `candidateAccessWhere` for raw SQL: a predicate over the candidate id in `candidateId`. */
export function candidateAccessSql(ctx: TenantContext, candidateId: Prisma.Sql): Prisma.Sql {
  if (seesWholeCompany(ctx)) return Prisma.sql`TRUE`;
  return Prisma.sql`EXISTS (
    SELECT 1 FROM "Application" a
    WHERE a."candidateId" = ${candidateId}
      AND a."companyId" = ${ctx.companyId}
      AND a."deletedAt" IS NULL
      AND ${jobAccessSql(ctx, Prisma.sql`a."jobId"`)}
  )`;
}

export function seesScores(ctx: TenantContext): boolean {
  return can(ctx.role, "scoring.view");
}
