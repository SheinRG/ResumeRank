import { requireMember, tenantContext } from "@/lib/auth/guards";
import * as scoring from "@resumerank/core/services/scoring";

export type {
  JobScoringProgress,
  JobScoringRequestResult,
  ScoringRequestResult,
  ScoringRunView,
} from "@resumerank/core/services/scoring";

export async function getScoringRun(runId: string): Promise<scoring.ScoringRunView | null> {
  const user = await requireMember();
  return scoring.getScoringRun(tenantContext(user), runId);
}

export async function getJobScoringProgress(
  jobId: string,
): Promise<scoring.JobScoringProgress | null> {
  const user = await requireMember();
  return scoring.getJobScoringProgress(tenantContext(user), jobId);
}
