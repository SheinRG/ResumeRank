"use server";

import { revalidatePath } from "next/cache";
import { db } from "@resumerank/core/db";
import { Prisma, type Candidate } from "@resumerank/core/generated/prisma/client";
import { requireWriter } from "@/lib/auth/guards";
import { candidateCreateSchema, candidateUpdateSchema } from "@resumerank/core/validators/candidate";
import { runAction } from "@/server/run-action";
import { logActivity } from "@resumerank/core/activity";
import { actionError, actionOk, type ActionResult } from "@resumerank/core/types/action";

const DUPLICATE_EMAIL_ERROR = "A candidate with this email already exists.";

export async function createCandidateAction(
  input: unknown,
): Promise<ActionResult<Candidate>> {
  return runAction(async () => {
    const parsed = candidateCreateSchema.safeParse(input);
    if (!parsed.success) {
      return actionError(
        "Check the highlighted fields.",
        parsed.error.flatten().fieldErrors,
      );
    }
    const user = await requireWriter();

    let candidate: Candidate;
    try {
      candidate = await db.candidate.create({
        data: { ...parsed.data, createdById: user.id },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return actionError("Check the highlighted fields.", {
          email: [DUPLICATE_EMAIL_ERROR],
        });
      }
      throw error;
    }

    await logActivity({
      actorId: user.id,
      action: "candidate.create",
      entityType: "candidate",
      entityId: candidate.id,
      summary: `added candidate "${candidate.name}"`,
    });

    revalidatePath("/candidates");
    revalidatePath("/dashboard");

    return actionOk(candidate);
  });
}

export async function updateCandidateAction(
  input: unknown,
): Promise<ActionResult<Candidate>> {
  return runAction(async () => {
    const parsed = candidateUpdateSchema.safeParse(input);
    if (!parsed.success) {
      return actionError(
        "Check the highlighted fields.",
        parsed.error.flatten().fieldErrors,
      );
    }
    const user = await requireWriter();
    const { id, ...fields } = parsed.data;

    let candidate: Candidate;
    try {
      candidate = await db.candidate.update({ where: { id }, data: fields });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return actionError("Check the highlighted fields.", {
          email: [DUPLICATE_EMAIL_ERROR],
        });
      }
      throw error;
    }

    await logActivity({
      actorId: user.id,
      action: "candidate.update",
      entityType: "candidate",
      entityId: candidate.id,
      summary: `updated candidate "${candidate.name}"`,
    });

    revalidatePath("/candidates");
    revalidatePath(`/candidates/${candidate.id}`);

    return actionOk(candidate);
  });
}

export async function deleteCandidateAction(
  id: string,
): Promise<ActionResult<Candidate>> {
  return runAction(async () => {
    const user = await requireWriter();
    const candidate = await db.candidate.delete({ where: { id } });

    await logActivity({
      actorId: user.id,
      action: "candidate.delete",
      entityType: "candidate",
      entityId: candidate.id,
      summary: `deleted candidate "${candidate.name}"`,
    });

    revalidatePath("/candidates");
    revalidatePath("/dashboard");

    return actionOk(candidate);
  });
}
