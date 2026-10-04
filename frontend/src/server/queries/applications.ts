import { requireMember, tenantContext } from "@/lib/auth/guards";
import * as applications from "@resumerank/core/services/applications";
import type { ApplicationListParams } from "@resumerank/core/validators/search";
import type { Paged } from "@resumerank/core/types/paged";

export type {
  ApplicationCandidateDetail,
  ApplicationDetail,
  ApplicationListItem,
  ApplicationScoring,
  EvaluationItem,
  ScorecardItem,
  ScoringHistoryItem,
} from "@resumerank/core/services/applications";

export async function listApplicationsForJob(
  jobId: string,
  params: ApplicationListParams,
): Promise<Paged<applications.ApplicationListItem>> {
  const user = await requireMember();
  return applications.listApplicationsForJob(tenantContext(user), jobId, params);
}

export async function getApplication(
  id: string,
): Promise<applications.ApplicationDetail | null> {
  const user = await requireMember();
  return applications.getApplication(tenantContext(user), id);
}
