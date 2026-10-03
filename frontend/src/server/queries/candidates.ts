import { requireMember, requireWriter, tenantContext } from "@/lib/auth/guards";
import * as candidates from "@resumerank/core/services/candidates";
import type { CandidateListParams } from "@resumerank/core/validators/search";
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

export async function listCandidateOptions(): Promise<candidates.CandidateOption[]> {
  const user = await requireMember();
  return candidates.listCandidateOptions(tenantContext(user));
}

export async function exportCandidatesCsv(
  params: CandidateListParams,
): Promise<candidates.CandidateCsvExport> {
  const user = await requireWriter();
  return candidates.exportCandidatesCsv(tenantContext(user), params);
}
