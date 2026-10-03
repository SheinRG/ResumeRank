"use server";

import { revalidatePath } from "next/cache";
import { requireWriter, tenantContext } from "@/lib/auth/guards";
import { scoreApplication, type ScoreOutcome } from "@resumerank/core/services/scoring";
import { runAction } from "@/server/run-action";
import { actionOk, type ActionResult } from "@resumerank/core/types/action";

export async function scoreApplicationAction(
  applicationId: string,
): Promise<ActionResult<ScoreOutcome>> {
  return runAction(async () => {
    const user = await requireWriter();
    const outcome = await scoreApplication(tenantContext(user), applicationId);

    revalidatePath(`/applications/${applicationId}`);
    revalidatePath(`/jobs/${outcome.jobId}`);
    revalidatePath(`/candidates/${outcome.candidateId}`);
    revalidatePath("/dashboard");

    return actionOk(outcome);
  });
}
