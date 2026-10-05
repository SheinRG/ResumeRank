import { requireMember, requireWriter, tenantContext } from "@/lib/auth/guards";
import * as candidates from "@resumerank/core/services/candidates";
import type {
  CandidateListParams,
  CandidateOptionParams,
} from "@resumerank/core/validators/search";
import type { Paged } from "@resumerank/core/types/paged";

export type {
  CandidateApplicationItem,
  CandidateCsvExport,
  CandidateDetail,
  CandidateListItem,
  CandidateOption,
} from "@resumerank/core/services/candidates";

export async function listCandidates(
  params: CandidateListParams,
): Promise<Paged<candidates.CandidateListItem>> {
  const user = await requireMember();
  return candidates.listCandidates(tenantContext(user), params);
}

export async function getCandidate(id: string): Promise<candidates.CandidateDetail | null> {
  const user = await requireMember();
  return candidates.getCandidate(tenantContext(user), id);
}

/** Only writers can attach candidates, so only they get the picker's search. */
export async function searchCandidateOptions(
  jobId: string,
  params: CandidateOptionParams,
): Promise<candidates.CandidateOption[]> {
  const user = await requireWriter();
  return candidates.searchCandidateOptions(tenantContext(user), jobId, params);
}

export async function exportCandidatesCsv(
  params: CandidateListParams,
): Promise<candidates.CandidateCsvExport> {
  const user = await requireWriter();
  return candidates.exportCandidatesCsv(tenantContext(user), params);
}
