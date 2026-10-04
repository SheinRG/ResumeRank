"use server";

import { revalidatePath } from "next/cache";
import type { Application } from "@resumerank/core/generated/prisma/client";
import { requireWriter, tenantContext } from "@/lib/auth/guards";
import {
  applicationCreateSchema,
  applicationStageSchema,
} from "@resumerank/core/validators/application";
import {
  createApplication,
  setApplicationRemoved,
  updateStage,
} from "@resumerank/core/services/applications";
import { runAction } from "@/server/run-action";
import { actionError, actionOk, type ActionResult } from "@resumerank/core/types/action";

function revalidateApplication(application: Application): void {
  revalidatePath(`/jobs/${application.jobId}`);
  revalidatePath(`/applications/${application.id}`);
  revalidatePath("/dashboard");
  revalidatePath(`/candidates/${application.candidateId}`);
}

export async function createApplicationAction(
  input: unknown,
): Promise<ActionResult<Application>> {
  return runAction("createApplication", async () => {
    const parsed = applicationCreateSchema.safeParse(input);
    if (!parsed.success) {
      return actionError(
        "Check the highlighted fields.",
        parsed.error.flatten().fieldErrors,
      );
    }
    const user = await requireWriter();
    const application = await createApplication(tenantContext(user), parsed.data);
    revalidateApplication(application);
    return actionOk(application);
  });
}

export async function updateStageAction(
  input: unknown,
): Promise<ActionResult<Application>> {
  return runAction("updateStage", async () => {
    const parsed = applicationStageSchema.safeParse(input);
    if (!parsed.success) {
      return actionError(
        "Check the highlighted fields.",
        parsed.error.flatten().fieldErrors,
      );
    }
    const user = await requireWriter();
    const application = await updateStage(tenantContext(user), parsed.data);
    revalidateApplication(application);
    return actionOk(application);
  });
}

export async function softDeleteApplicationAction(
  id: string,
): Promise<ActionResult<Application>> {
  return runAction("softDeleteApplication", async () => {
    const user = await requireWriter();
    const application = await setApplicationRemoved(tenantContext(user), id, true);
    revalidateApplication(application);
    return actionOk(application);
  });
}

export async function restoreApplicationAction(
  id: string,
): Promise<ActionResult<Application>> {
  return runAction("restoreApplication", async () => {
    const user = await requireWriter();
    const application = await setApplicationRemoved(tenantContext(user), id, false);
    revalidateApplication(application);
    return actionOk(application);
  });
}
