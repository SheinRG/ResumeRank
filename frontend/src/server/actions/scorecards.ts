"use server";

import { revalidatePath } from "next/cache";
import { db } from "@resumerank/core/db";
import type { Scorecard } from "@resumerank/core/generated/prisma/client";
import { requireWriter } from "@/lib/auth/guards";
import { scorecardSchema } from "@resumerank/core/validators/application";
import { runAction } from "@/server/run-action";
import { logActivity } from "@resumerank/core/activity";
import { actionError, actionOk, type ActionResult } from "@resumerank/core/types/action";

export async function upsertScorecardAction(
  input: unknown,
): Promise<ActionResult<Scorecard>> {
  return runAction(async () => {
    const parsed = scorecardSchema.safeParse(input);
    if (!parsed.success) {
      return actionError(
        "Check the highlighted fields.",
        parsed.error.flatten().fieldErrors,
      );
    }
    const user = await requireWriter();
    const { applicationId, rating, notes } = parsed.data;

    const application = await db.application.findUnique({
      where: { id: applicationId, companyId: user.companyId },
      select: { id: true, candidate: { select: { name: true } } },
    });
    if (!application) {
      return actionError("This application no longer exists.");
    }

    // reviewerId always comes from the session — a client-supplied reviewer would let anyone rate as someone else.
    const scorecard = await db.scorecard.upsert({
      where: { applicationId_reviewerId: { applicationId, reviewerId: user.id } },
      create: { applicationId, reviewerId: user.id, rating, notes },
      update: { rating, notes },
    });

    await logActivity({
      companyId: user.companyId,
      actorId: user.id,
      action: "scorecard.upsert",
      entityType: "application",
      entityId: applicationId,
      summary: `rated ${application.candidate.name} ${rating}/5`,
    });

    revalidatePath(`/applications/${applicationId}`);

    return actionOk(scorecard);
  });
}
