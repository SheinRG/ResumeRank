"use server";

import { revalidatePath } from "next/cache";
import { db } from "@resumerank/core/db";
import { requireWriter } from "@/lib/auth/guards";
import { scoreApplication, ScoringError, type ScoreOutcome } from "@resumerank/core/scoring/engine";
import { MIN_RESUME_LENGTH } from "@resumerank/core/validators/candidate";
import { runAction } from "@/server/run-action";
import { logActivity } from "@resumerank/core/activity";
import { actionError, actionOk, type ActionResult } from "@resumerank/core/types/action";

/**
 * The engine itself checks for a missing GROQ_API_KEY and a job with zero
 * requirements. Resume length is enforced by the candidate form schema at
 * write time, but a short resume can still reach this action (seeded data,
 * a direct edit) and would otherwise burn a Groq call on a guaranteed
 * rejection — so it's the one precondition worth checking here too.
 */
export async function scoreApplicationAction(
  applicationId: string,
): Promise<ActionResult<ScoreOutcome>> {
  return runAction(async () => {
    const user = await requireWriter();

    const application = await db.application.findUnique({
      where: { id: applicationId, companyId: user.companyId },
      select: {
        jobId: true,
        candidateId: true,
        deletedAt: true,
        candidate: { select: { name: true, resumeText: true } },
      },
    });
    if (!application || application.deletedAt) {
      return actionError("This application no longer exists.");
    }
    if (application.candidate.resumeText.trim().length < MIN_RESUME_LENGTH) {
      return actionError(
        `Add at least ${MIN_RESUME_LENGTH} characters of resume text before scoring.`,
      );
    }

    let outcome: ScoreOutcome;
    try {
      outcome = await scoreApplication(applicationId);
    } catch (error) {
      if (error instanceof ScoringError) {
        return actionError(error.message);
      }
      throw error;
    }

    await logActivity({
      companyId: user.companyId,
      actorId: user.id,
      action: "application.score",
      entityType: "application",
      entityId: applicationId,
      summary: `scored ${application.candidate.name} at ${outcome.aiScore}`,
    });

    revalidatePath(`/applications/${applicationId}`);
    revalidatePath(`/jobs/${application.jobId}`);
    revalidatePath(`/candidates/${application.candidateId}`);
    revalidatePath("/dashboard");

    return actionOk(outcome);
  });
}
