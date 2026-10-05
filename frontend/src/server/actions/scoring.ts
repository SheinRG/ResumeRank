"use server";

import { revalidatePath } from "next/cache";
import { requireWriter, tenantContext } from "@/lib/auth/guards";
import {
  requestJobScoring,
  requestScoring,
  type JobScoringRequestResult,
  type ScoringRequestResult,
} from "@resumerank/core/services/scoring";
import { expireTenantReads } from "@/server/cache-tags";
import { runAction } from "@/server/run-action";
import { scheduleScoringDrain } from "@/server/scoring-drain";
import { actionOk, type ActionResult } from "@resumerank/core/types/action";

export async function requestScoringAction(
  applicationId: string,
): Promise<ActionResult<ScoringRequestResult>> {
  return runAction("requestScoring", async () => {
    const user = await requireWriter();
    const result = await requestScoring(tenantContext(user), applicationId);

    if (result.outcome === "reused") {
      revalidatePath(`/applications/${applicationId}`);
    } else {
      scheduleScoringDrain();
    }
    expireTenantReads(user.companyId);
    return actionOk(result);
  });
}

export async function requestJobScoringAction(
  jobId: string,
): Promise<ActionResult<JobScoringRequestResult>> {
  return runAction("requestJobScoring", async () => {
    const user = await requireWriter();
    const result = await requestJobScoring(tenantContext(user), jobId);

    if (result.queued > 0) scheduleScoringDrain();
    revalidatePath(`/jobs/${jobId}`);
    expireTenantReads(user.companyId);
    return actionOk(result);
  });
}
