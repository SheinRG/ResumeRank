/**
 * Audit entries never contain a candidate's name. The audit log is sealed
 * into a hash chain and can't be edited, so a name written into it could
 * never be erased (GDPR Art. 17). Summaries say `{candidate}` instead and
 * carry the candidate's id in `metadata.candidateId` (or as the entity id),
 * and readers put the current name back, or "a deleted candidate" once the
 * candidate has been erased.
 */
export const CANDIDATE_REF = "{candidate}";

export const ERASED_CANDIDATE = "a deleted candidate";

export interface CandidateRefEntry {
  entityType: string;
  entityId: string;
  metadata: unknown;
}

/** The candidate an entry refers to, if it refers to one. */
export function referencedCandidateId(entry: CandidateRefEntry): string | null {
  if (entry.entityType === "candidate") return entry.entityId;
  const metadata = entry.metadata;
  if (typeof metadata === "object" && metadata !== null && "candidateId" in metadata) {
    const id = metadata.candidateId;
    return typeof id === "string" ? id : null;
  }
  return null;
}

/** The summary as people read it: `{candidate}` becomes the name, if the candidate still exists. */
export function renderSummary(summary: string, candidateName: string | null): string {
  if (!summary.includes(CANDIDATE_REF)) return summary;
  return summary.split(CANDIDATE_REF).join(candidateName ?? ERASED_CANDIDATE);
}
