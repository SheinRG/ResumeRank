import { tenantDb, tenantTransaction, type TenantTx } from "../tenant-db";
import { logActivity } from "../activity";
import type { Job, Prisma } from "../generated/prisma/client";
import type { Role } from "../validators/enums";
import type { JobAssignmentInput, JobDepartmentInput } from "../validators/department";
import { assertCan, type TenantContext } from "./context";
import { jobAccessWhere } from "./access";
import { ConflictError, NotFoundError } from "./errors";
import { isPrismaError } from "./prisma-errors";

export interface HiringTeamMember {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: Role;
  /** Assigned to this job, or reaching it through its department. */
  via: "job" | "department";
}

export interface HiringTeam {
  department: { id: string; name: string } | null;
  members: HiringTeamMember[];
}

const JOB_NOT_FOUND = "This job no longer exists.";

const PERSON_SELECT = {
  role: true,
  user: { select: { id: true, name: true, email: true, image: true } },
} satisfies Prisma.MembershipSelect;

type Person = Prisma.MembershipGetPayload<{ select: typeof PERSON_SELECT }>;

function toTeamMember({ role, user }: Person, via: HiringTeamMember["via"]): HiringTeamMember {
  return { userId: user.id, name: user.name, email: user.email, image: user.image, role, via };
}

/** Everyone working on a job: its own team first, then its department's. */
export async function getHiringTeam(ctx: TenantContext, jobId: string): Promise<HiringTeam | null> {
  const job = await tenantDb(ctx).job.findFirst({
    where: { id: jobId, companyId: ctx.companyId, ...jobAccessWhere(ctx) },
    select: {
      department: {
        select: {
          id: true,
          name: true,
          members: { select: { membership: { select: PERSON_SELECT } } },
        },
      },
      assignments: { select: { membership: { select: PERSON_SELECT } } },
    },
  });
  if (!job) return null;

  const byName = (a: HiringTeamMember, b: HiringTeamMember) => a.name.localeCompare(b.name);
  const assigned = job.assignments.map((row) => toTeamMember(row.membership, "job")).sort(byName);
  const onJob = new Set(assigned.map((member) => member.userId));
  const viaDepartment = (job.department?.members ?? [])
    .map((row) => toTeamMember(row.membership, "department"))
    .filter((member) => !onJob.has(member.userId))
    .sort(byName);
  return {
    department: job.department ? { id: job.department.id, name: job.department.name } : null,
    members: [...assigned, ...viaDepartment],
  };
}

async function findStaffableJob(tx: TenantTx, ctx: TenantContext, jobId: string): Promise<Job> {
  const job = await tx.job.findFirst({ where: { id: jobId, companyId: ctx.companyId, ...jobAccessWhere(ctx) } });
  if (!job) throw new NotFoundError(JOB_NOT_FOUND);
  return job;
}

export async function assignToJob(
  ctx: TenantContext,
  input: JobAssignmentInput,
): Promise<HiringTeamMember> {
  assertCan(ctx, "job.staff");
  const { jobId, userId } = input;
  try {
    return await tenantTransaction(ctx, async (tx) => {
      const job = await findStaffableJob(tx, ctx, jobId);
      const membership = await tx.membership.findUnique({
        where: { userId_companyId: { userId, companyId: ctx.companyId } },
        select: PERSON_SELECT,
      });
      if (!membership) throw new NotFoundError("That teammate is no longer in this workspace.");

      await tx.jobAssignment.create({ data: { jobId, userId, companyId: ctx.companyId } });
      const member = toTeamMember(membership, "job");
      await logActivity(
        {
          companyId: ctx.companyId,
          actorId: ctx.actorId,
          action: "job.assign",
          entityType: "job",
          entityId: jobId,
          summary: `added ${member.name} to the hiring team for "${job.title}"`,
          metadata: { userId },
        },
        tx,
      );
      return member;
    });
  } catch (error) {
    if (isPrismaError(error, "P2002")) throw new ConflictError("They're already on this job's hiring team.");
    throw error;
  }
}

export async function unassignFromJob(
  ctx: TenantContext,
  input: JobAssignmentInput,
): Promise<HiringTeamMember> {
  assertCan(ctx, "job.staff");
  const { jobId, userId } = input;
  return tenantTransaction(ctx, async (tx) => {
    const job = await findStaffableJob(tx, ctx, jobId);
    const assignment = await tx.jobAssignment.findUnique({
      where: { jobId_userId: { jobId, userId }, companyId: ctx.companyId },
      select: { id: true, membership: { select: PERSON_SELECT } },
    });
    if (!assignment) throw new NotFoundError("They're no longer on this job's hiring team.");

    await tx.jobAssignment.delete({ where: { id: assignment.id, companyId: ctx.companyId } });
    const member = toTeamMember(assignment.membership, "job");
    await logActivity(
      {
        companyId: ctx.companyId,
        actorId: ctx.actorId,
        action: "job.unassign",
        entityType: "job",
        entityId: jobId,
        summary: `removed ${member.name} from the hiring team for "${job.title}"`,
        metadata: { userId },
      },
      tx,
    );
    return member;
  });
}

/** Files a job under a department (or none), which changes who reaches it through one. */
export async function setJobDepartment(ctx: TenantContext, input: JobDepartmentInput): Promise<Job> {
  assertCan(ctx, "job.staff");
  const { jobId, departmentId } = input;
  return tenantTransaction(ctx, async (tx) => {
    const job = await findStaffableJob(tx, ctx, jobId);
    // The foreign key alone would accept another company's department.
    const department = departmentId
      ? await tx.department.findUnique({ where: { id: departmentId, companyId: ctx.companyId } })
      : null;
    if (departmentId && !department) {
      throw new NotFoundError("Check the highlighted fields.", {
        departmentId: ["That department no longer exists."],
      });
    }

    const updated = await tx.job.update({
      where: { id: job.id, companyId: ctx.companyId },
      data: { departmentId },
    });
    await logActivity(
      {
        companyId: ctx.companyId,
        actorId: ctx.actorId,
        action: "job.department",
        entityType: "job",
        entityId: job.id,
        summary: department
          ? `filed "${job.title}" under ${department.name}`
          : `removed "${job.title}" from its department`,
        metadata: { from: job.departmentId, to: departmentId },
      },
      tx,
    );
    return updated;
  });
}
