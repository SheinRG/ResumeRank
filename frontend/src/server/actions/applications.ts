"use server";

import { revalidatePath } from "next/cache";
import { db } from "@resumerank/core/db";
import { Prisma, type Application } from "@resumerank/core/generated/prisma/client";
import { requireWriter } from "@/lib/auth/guards";
import {
  applicationCreateSchema,
  applicationStageSchema,
} from "@resumerank/core/validators/application";
import { runAction } from "@/server/run-action";
import { logActivity } from "@resumerank/core/activity";
import { actionError, actionOk, type ActionResult } from "@resumerank/core/types/action";

function revalidateApplication(jobId: string, applicationId: string, candidateId: string): void {
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/applications/${applicationId}`);
  revalidatePath("/dashboard");
  revalidatePath(`/candidates/${candidateId}`);
}

export async function createApplicationAction(
  input: unknown,
): Promise<ActionResult<Application>> {
  return runAction(async () => {
    const parsed = applicationCreateSchema.safeParse(input);
    if (!parsed.success) {
      return actionError(
        "Check the highlighted fields.",
        parsed.error.flatten().fieldErrors,
      );
    }
    const user = await requireWriter();
    const { jobId, candidateId } = parsed.data;

    const [job, candidate] = await Promise.all([
      db.job.findUnique({ where: { id: jobId }, select: { id: true, title: true, status: true } }),
      db.candidate.findUnique({ where: { id: candidateId }, select: { id: true, name: true } }),
    ]);
    if (!job) {
      return actionError("Check the highlighted fields.", {
        jobId: ["That job no longer exists."],
      });
    }
    if (!candidate) {
      return actionError("Check the highlighted fields.", {
        candidateId: ["That candidate no longer exists."],
      });
    }
    if (job.status === "ARCHIVED") {
      return actionError("This job is archived — reopen it before adding applications.");
    }

    let application: Application;
    try {
      application = await db.application.create({
        data: { jobId, candidateId, createdById: user.id },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return actionError("This candidate is already attached to this job.");
      }
      throw error;
    }

    await logActivity({
      actorId: user.id,
      action: "application.create",
      entityType: "application",
      entityId: application.id,
      summary: `attached ${candidate.name} to "${job.title}"`,
    });

    revalidateApplication(jobId, application.id, candidateId);

    return actionOk(application);
  });
}

export async function updateStageAction(
  input: unknown,
): Promise<ActionResult<Application>> {
  return runAction(async () => {
    const parsed = applicationStageSchema.safeParse(input);
    if (!parsed.success) {
      return actionError(
        "Check the highlighted fields.",
        parsed.error.flatten().fieldErrors,
      );
    }
    const user = await requireWriter();
    const { id, stage } = parsed.data;

    const existing = await db.application.findUnique({
      where: { id },
      select: { stage: true, candidate: { select: { name: true } } },
    });
    if (!existing) {
      return actionError("This application no longer exists.");
    }

    const application = await db.application.update({ where: { id }, data: { stage } });

    await logActivity({
      actorId: user.id,
      action: "application.stage",
      entityType: "application",
      entityId: application.id,
      summary: `moved ${existing.candidate.name} to ${stage}`,
      metadata: { from: existing.stage, to: stage },
    });

    revalidateApplication(application.jobId, application.id, application.candidateId);

    return actionOk(application);
  });
}

export async function softDeleteApplicationAction(
  id: string,
): Promise<ActionResult<Application>> {
  return runAction(async () => {
    const user = await requireWriter();
    const application = await db.application.update({
      where: { id },
      data: { deletedAt: new Date() },
      include: { candidate: { select: { name: true } } },
    });

    await logActivity({
      actorId: user.id,
      action: "application.delete",
      entityType: "application",
      entityId: application.id,
      summary: `removed ${application.candidate.name} from the pipeline`,
    });

    revalidateApplication(application.jobId, application.id, application.candidateId);

    return actionOk(application);
  });
}

export async function restoreApplicationAction(
  id: string,
): Promise<ActionResult<Application>> {
  return runAction(async () => {
    const user = await requireWriter();
    const application = await db.application.update({
      where: { id },
      data: { deletedAt: null },
      include: { candidate: { select: { name: true } } },
    });

    await logActivity({
      actorId: user.id,
      action: "application.restore",
      entityType: "application",
      entityId: application.id,
      summary: `restored ${application.candidate.name} to the pipeline`,
    });

    revalidateApplication(application.jobId, application.id, application.candidateId);

    return actionOk(application);
  });
}
