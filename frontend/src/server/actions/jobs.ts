"use server";

import { revalidatePath } from "next/cache";
import { db } from "@resumerank/core/db";
import { requireWriter } from "@/lib/auth/guards";
import { jobCreateSchema, jobUpdateSchema } from "@resumerank/core/validators/job";
import { runAction } from "@/server/run-action";
import { logActivity } from "@resumerank/core/activity";
import { actionError, actionOk, type ActionResult } from "@resumerank/core/types/action";
import type { JobDetail } from "@/server/queries/jobs";

export async function createJobAction(
  input: unknown,
): Promise<ActionResult<JobDetail>> {
  return runAction(async () => {
    const parsed = jobCreateSchema.safeParse(input);
    if (!parsed.success) {
      return actionError(
        "Check the highlighted fields.",
        parsed.error.flatten().fieldErrors,
      );
    }
    const user = await requireWriter();
    const { requirements, ...jobFields } = parsed.data;

    const job = await db.job.create({
      data: {
        ...jobFields,
        createdById: user.id,
        requirements: {
          create: requirements.map((r, index) => ({
            label: r.label,
            weight: r.weight,
            order: index,
          })),
        },
      },
      include: { requirements: { orderBy: { order: "asc" } } },
    });

    await logActivity({
      actorId: user.id,
      action: "job.create",
      entityType: "job",
      entityId: job.id,
      summary: `created job "${job.title}"`,
    });

    revalidatePath("/jobs");
    revalidatePath("/dashboard");

    return actionOk(job);
  });
}

export async function updateJobAction(
  input: unknown,
): Promise<ActionResult<JobDetail>> {
  return runAction(async () => {
    const parsed = jobUpdateSchema.safeParse(input);
    if (!parsed.success) {
      return actionError(
        "Check the highlighted fields.",
        parsed.error.flatten().fieldErrors,
      );
    }
    const user = await requireWriter();
    const { id, requirements, ...jobFields } = parsed.data;

    const existing = await db.jobRequirement.findMany({
      where: { jobId: id },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((r) => r.id));
    const keepIds = new Set(
      requirements.filter((r) => r.id).map((r) => r.id as string),
    );
    const toDelete = [...existingIds].filter((rid) => !keepIds.has(rid));

    const job = await db.$transaction(async (tx) => {
      await tx.job.update({ where: { id }, data: jobFields });

      if (toDelete.length) {
        await tx.jobRequirement.deleteMany({ where: { id: { in: toDelete } } });
      }

      for (const [index, requirement] of requirements.entries()) {
        if (requirement.id && existingIds.has(requirement.id)) {
          await tx.jobRequirement.update({
            where: { id: requirement.id },
            data: { label: requirement.label, weight: requirement.weight, order: index },
          });
        } else {
          await tx.jobRequirement.create({
            data: {
              jobId: id,
              label: requirement.label,
              weight: requirement.weight,
              order: index,
            },
          });
        }
      }

      return tx.job.findUniqueOrThrow({
        where: { id },
        include: { requirements: { orderBy: { order: "asc" } } },
      });
    });

    await logActivity({
      actorId: user.id,
      action: "job.update",
      entityType: "job",
      entityId: job.id,
      summary: `updated job "${job.title}"`,
    });

    revalidatePath("/jobs");
    revalidatePath(`/jobs/${job.id}`);

    return actionOk(job);
  });
}

export async function archiveJobAction(id: string): Promise<ActionResult<JobDetail>> {
  return runAction(async () => {
    const user = await requireWriter();
    const job = await db.job.update({
      where: { id },
      data: { status: "ARCHIVED" },
      include: { requirements: { orderBy: { order: "asc" } } },
    });

    await logActivity({
      actorId: user.id,
      action: "job.archive",
      entityType: "job",
      entityId: job.id,
      summary: `archived job "${job.title}"`,
    });

    revalidatePath("/jobs");
    revalidatePath(`/jobs/${job.id}`);
    revalidatePath("/dashboard");

    return actionOk(job);
  });
}

export async function reopenJobAction(id: string): Promise<ActionResult<JobDetail>> {
  return runAction(async () => {
    const user = await requireWriter();
    const job = await db.job.update({
      where: { id },
      data: { status: "OPEN" },
      include: { requirements: { orderBy: { order: "asc" } } },
    });

    await logActivity({
      actorId: user.id,
      action: "job.reopen",
      entityType: "job",
      entityId: job.id,
      summary: `reopened job "${job.title}"`,
    });

    revalidatePath("/jobs");
    revalidatePath(`/jobs/${job.id}`);
    revalidatePath("/dashboard");

    return actionOk(job);
  });
}
