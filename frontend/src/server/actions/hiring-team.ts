"use server";

import { revalidatePath } from "next/cache";
import type { Job } from "@resumerank/core/generated/prisma/client";
import { requireCan, tenantContext } from "@/lib/auth/guards";
import { jobAssignmentSchema, jobDepartmentSchema } from "@resumerank/core/validators/department";
import {
  assignToJob,
  setJobDepartment,
  unassignFromJob,
  type HiringTeamMember,
} from "@resumerank/core/services/hiring-team";
import { expireTenantReads } from "@/server/cache-tags";
import { runAction } from "@/server/run-action";
import { actionError, actionOk, type ActionResult } from "@resumerank/core/types/action";

export async function assignToJobAction(input: unknown): Promise<ActionResult<HiringTeamMember>> {
  return runAction("assignToJob", async () => {
    const parsed = jobAssignmentSchema.safeParse(input);
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const user = await requireCan("job.staff");
    const member = await assignToJob(tenantContext(user), parsed.data);

    revalidatePath(`/jobs/${parsed.data.jobId}`);
    expireTenantReads(user.companyId);

    return actionOk(member);
  });
}

export async function unassignFromJobAction(input: unknown): Promise<ActionResult<HiringTeamMember>> {
  return runAction("unassignFromJob", async () => {
    const parsed = jobAssignmentSchema.safeParse(input);
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const user = await requireCan("job.staff");
    const member = await unassignFromJob(tenantContext(user), parsed.data);

    revalidatePath(`/jobs/${parsed.data.jobId}`);
    expireTenantReads(user.companyId);

    return actionOk(member);
  });
}

export async function setJobDepartmentAction(input: unknown): Promise<ActionResult<Job>> {
  return runAction("setJobDepartment", async () => {
    const parsed = jobDepartmentSchema.safeParse(input);
    if (!parsed.success) {
      return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
    }
    const user = await requireCan("job.staff");
    const job = await setJobDepartment(tenantContext(user), parsed.data);

    revalidatePath(`/jobs/${job.id}`);
    expireTenantReads(user.companyId);

    return actionOk(job);
  });
}
