"use server";

import { revalidatePath } from "next/cache";
import { requireWriter, tenantContext } from "@/lib/auth/guards";
import { jobCreateSchema, jobUpdateSchema } from "@resumerank/core/validators/job";
import {
  createJob,
  setJobStatus,
  updateJob,
  type JobDetail,
} from "@resumerank/core/services/jobs";
import { runAction } from "@/server/run-action";
import { actionError, actionOk, type ActionResult } from "@resumerank/core/types/action";

export async function createJobAction(
  input: unknown,
): Promise<ActionResult<JobDetail>> {
  return runAction("createJob", async () => {
    const parsed = jobCreateSchema.safeParse(input);
    if (!parsed.success) {
      return actionError(
        "Check the highlighted fields.",
        parsed.error.flatten().fieldErrors,
      );
    }
    const user = await requireWriter();
    const job = await createJob(tenantContext(user), parsed.data);

    revalidatePath("/jobs");
    revalidatePath("/dashboard");

    return actionOk(job);
  });
}

export async function updateJobAction(
  input: unknown,
): Promise<ActionResult<JobDetail>> {
  return runAction("updateJob", async () => {
    const parsed = jobUpdateSchema.safeParse(input);
    if (!parsed.success) {
      return actionError(
        "Check the highlighted fields.",
        parsed.error.flatten().fieldErrors,
      );
    }
    const user = await requireWriter();
    const job = await updateJob(tenantContext(user), parsed.data);

    revalidatePath("/jobs");
    revalidatePath(`/jobs/${job.id}`);

    return actionOk(job);
  });
}

export async function archiveJobAction(id: string): Promise<ActionResult<JobDetail>> {
  return runAction("archiveJob", async () => {
    const user = await requireWriter();
    const job = await setJobStatus(tenantContext(user), id, "ARCHIVED");

    revalidatePath("/jobs");
    revalidatePath(`/jobs/${job.id}`);
    revalidatePath("/dashboard");

    return actionOk(job);
  });
}

export async function reopenJobAction(id: string): Promise<ActionResult<JobDetail>> {
  return runAction("reopenJob", async () => {
    const user = await requireWriter();
    const job = await setJobStatus(tenantContext(user), id, "OPEN");

    revalidatePath("/jobs");
    revalidatePath(`/jobs/${job.id}`);
    revalidatePath("/dashboard");

    return actionOk(job);
  });
}
