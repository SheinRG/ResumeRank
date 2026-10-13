"use server";

import { revalidatePath } from "next/cache";
import type { Department } from "@resumerank/core/generated/prisma/client";
import { requireCan, tenantContext } from "@/lib/auth/guards";
import {
  departmentCreateSchema,
  departmentIdSchema,
  departmentMemberSchema,
  departmentRenameSchema,
} from "@resumerank/core/validators/department";
import {
  addDepartmentMember,
  createDepartment,
  deleteDepartment,
  removeDepartmentMember,
  renameDepartment,
  type DepartmentMemberItem,
} from "@resumerank/core/services/departments";
import { expireTenantReads } from "@/server/cache-tags";
import { runAction } from "@/server/run-action";
import { actionError, actionOk, type ActionResult } from "@resumerank/core/types/action";

const DEPARTMENTS_PATH = "/settings/departments";

export async function createDepartmentAction(input: unknown): Promise<ActionResult<Department>> {
  return runAction("createDepartment", async () => {
    const parsed = departmentCreateSchema.safeParse(input);
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const user = await requireCan("department.manage");
    const department = await createDepartment(tenantContext(user), parsed.data);

    revalidatePath(DEPARTMENTS_PATH);
    expireTenantReads(user.companyId);

    return actionOk(department);
  });
}

export async function renameDepartmentAction(input: unknown): Promise<ActionResult<Department>> {
  return runAction("renameDepartment", async () => {
    const parsed = departmentRenameSchema.safeParse(input);
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const user = await requireCan("department.manage");
    const department = await renameDepartment(tenantContext(user), parsed.data);

    revalidatePath(DEPARTMENTS_PATH);
    expireTenantReads(user.companyId);

    return actionOk(department);
  });
}

export async function deleteDepartmentAction(input: unknown): Promise<ActionResult<Department>> {
  return runAction("deleteDepartment", async () => {
    const parsed = departmentIdSchema.safeParse(input);
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const user = await requireCan("department.manage");
    const department = await deleteDepartment(tenantContext(user), parsed.data);

    revalidatePath(DEPARTMENTS_PATH);
    expireTenantReads(user.companyId);

    return actionOk(department);
  });
}

export async function addDepartmentMemberAction(
  input: unknown,
): Promise<ActionResult<DepartmentMemberItem>> {
  return runAction("addDepartmentMember", async () => {
    const parsed = departmentMemberSchema.safeParse(input);
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const user = await requireCan("department.manage");
    const member = await addDepartmentMember(tenantContext(user), parsed.data);

    revalidatePath(DEPARTMENTS_PATH);
    expireTenantReads(user.companyId);

    return actionOk(member);
  });
}

export async function removeDepartmentMemberAction(
  input: unknown,
): Promise<ActionResult<DepartmentMemberItem>> {
  return runAction("removeDepartmentMember", async () => {
    const parsed = departmentMemberSchema.safeParse(input);
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const user = await requireCan("department.manage");
    const member = await removeDepartmentMember(tenantContext(user), parsed.data);

    revalidatePath(DEPARTMENTS_PATH);
    expireTenantReads(user.companyId);

    return actionOk(member);
  });
}
