import { tenantDb, tenantTransaction, type TenantTx } from "../tenant-db";
import { logActivity } from "../activity";
import type { Department } from "../generated/prisma/client";
import type { Role } from "../validators/enums";
import type {
  DepartmentCreateInput,
  DepartmentIdInput,
  DepartmentMemberInput,
  DepartmentRenameInput,
} from "../validators/department";
import { assertCan, type TenantContext } from "./context";
import { ConflictError, NotFoundError } from "./errors";
import { isPrismaError } from "./prisma-errors";

export interface DepartmentMemberItem {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: Role;
}

export interface DepartmentItem {
  id: string;
  name: string;
  jobCount: number;
  members: DepartmentMemberItem[];
}

export interface DepartmentOption {
  id: string;
  name: string;
}

const DEPARTMENT_NOT_FOUND = "This department no longer exists.";
const TEAMMATE_NOT_FOUND = "That teammate is no longer in this workspace.";

function duplicateName(): ConflictError {
  return new ConflictError("Check the highlighted fields.", {
    name: ["A department with this name already exists."],
  });
}

export async function listDepartments(ctx: TenantContext): Promise<DepartmentItem[]> {
  assertCan(ctx, "department.manage");
  const rows = await tenantDb(ctx).department.findMany({
    where: { companyId: ctx.companyId },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      _count: { select: { jobs: true } },
      members: {
        orderBy: [{ membership: { user: { name: "asc" } } }, { id: "asc" }],
        select: {
          membership: {
            select: { role: true, user: { select: { id: true, name: true, email: true, image: true } } },
          },
        },
      },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    jobCount: row._count.jobs,
    members: row.members.map(({ membership: { role, user } }) => ({
      userId: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      role,
    })),
  }));
}

/** Names only, for filing a job; anyone who can staff a job may pick one. */
export async function listDepartmentOptions(ctx: TenantContext): Promise<DepartmentOption[]> {
  assertCan(ctx, "job.staff");
  return tenantDb(ctx).department.findMany({
    where: { companyId: ctx.companyId },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: { id: true, name: true },
  });
}

async function findDepartment(tx: TenantTx, ctx: TenantContext, id: string): Promise<Department> {
  const department = await tx.department.findUnique({ where: { id, companyId: ctx.companyId } });
  if (!department) throw new NotFoundError(DEPARTMENT_NOT_FOUND);
  return department;
}

export async function createDepartment(
  ctx: TenantContext,
  input: DepartmentCreateInput,
): Promise<Department> {
  assertCan(ctx, "department.manage");
  try {
    return await tenantTransaction(ctx, async (tx) => {
      const department = await tx.department.create({
        data: { name: input.name, companyId: ctx.companyId },
      });
      await logActivity(
        {
          companyId: ctx.companyId,
          actorId: ctx.actorId,
          action: "department.create",
          entityType: "department",
          entityId: department.id,
          summary: `created the ${department.name} department`,
        },
        tx,
      );
      return department;
    });
  } catch (error) {
    if (isPrismaError(error, "P2002")) throw duplicateName();
    throw error;
  }
}

export async function renameDepartment(
  ctx: TenantContext,
  input: DepartmentRenameInput,
): Promise<Department> {
  assertCan(ctx, "department.manage");
  try {
    return await tenantTransaction(ctx, async (tx) => {
      const previous = await findDepartment(tx, ctx, input.id);
      const department = await tx.department.update({
        where: { id: input.id, companyId: ctx.companyId },
        data: { name: input.name },
      });
      await logActivity(
        {
          companyId: ctx.companyId,
          actorId: ctx.actorId,
          action: "department.rename",
          entityType: "department",
          entityId: department.id,
          summary: `renamed the ${previous.name} department to ${department.name}`,
          metadata: { from: previous.name, to: department.name },
        },
        tx,
      );
      return department;
    });
  } catch (error) {
    if (isPrismaError(error, "P2002")) throw duplicateName();
    throw error;
  }
}

/** Its jobs stay, filed under no department; access through it ends with it. */
export async function deleteDepartment(
  ctx: TenantContext,
  input: DepartmentIdInput,
): Promise<Department> {
  assertCan(ctx, "department.manage");
  return tenantTransaction(ctx, async (tx) => {
    await findDepartment(tx, ctx, input.id);
    const department = await tx.department.delete({ where: { id: input.id, companyId: ctx.companyId } });
    await logActivity(
      {
        companyId: ctx.companyId,
        actorId: ctx.actorId,
        action: "department.delete",
        entityType: "department",
        entityId: department.id,
        summary: `deleted the ${department.name} department`,
      },
      tx,
    );
    return department;
  });
}

export async function addDepartmentMember(
  ctx: TenantContext,
  input: DepartmentMemberInput,
): Promise<DepartmentMemberItem> {
  assertCan(ctx, "department.manage");
  const { departmentId, userId } = input;
  try {
    return await tenantTransaction(ctx, async (tx) => {
      const department = await findDepartment(tx, ctx, departmentId);
      const membership = await tx.membership.findUnique({
        where: { userId_companyId: { userId, companyId: ctx.companyId } },
        select: { role: true, user: { select: { id: true, name: true, email: true, image: true } } },
      });
      if (!membership) throw new NotFoundError(TEAMMATE_NOT_FOUND);

      await tx.departmentMember.create({
        data: { departmentId, userId, companyId: ctx.companyId },
      });
      await logActivity(
        {
          companyId: ctx.companyId,
          actorId: ctx.actorId,
          action: "department.member_add",
          entityType: "department",
          entityId: departmentId,
          summary: `added ${membership.user.name} to the ${department.name} department`,
          metadata: { userId },
        },
        tx,
      );
      const { user, role } = membership;
      return { userId: user.id, name: user.name, email: user.email, image: user.image, role };
    });
  } catch (error) {
    if (isPrismaError(error, "P2002")) {
      throw new ConflictError("They're already in this department.");
    }
    throw error;
  }
}

export async function removeDepartmentMember(
  ctx: TenantContext,
  input: DepartmentMemberInput,
): Promise<DepartmentMemberItem> {
  assertCan(ctx, "department.manage");
  const { departmentId, userId } = input;
  return tenantTransaction(ctx, async (tx) => {
    const department = await findDepartment(tx, ctx, departmentId);
    const row = await tx.departmentMember.findUnique({
      where: { departmentId_userId: { departmentId, userId }, companyId: ctx.companyId },
      select: {
        id: true,
        membership: {
          select: { role: true, user: { select: { id: true, name: true, email: true, image: true } } },
        },
      },
    });
    if (!row) throw new NotFoundError("They're no longer in this department.");

    await tx.departmentMember.delete({ where: { id: row.id, companyId: ctx.companyId } });
    const { user, role } = row.membership;
    await logActivity(
      {
        companyId: ctx.companyId,
        actorId: ctx.actorId,
        action: "department.member_remove",
        entityType: "department",
        entityId: departmentId,
        summary: `removed ${user.name} from the ${department.name} department`,
        metadata: { userId },
      },
      tx,
    );
    return { userId: user.id, name: user.name, email: user.email, image: user.image, role };
  });
}
