import { canAdmin, requireAdmin, requireUser, tenantContext } from "@/lib/auth/guards";
import * as compliance from "@resumerank/core/services/compliance";
import * as dataRights from "@resumerank/core/services/data-rights";
import * as fairness from "@resumerank/core/services/fairness";
import * as offboarding from "@resumerank/core/services/offboarding";

export type { AiPolicy } from "@resumerank/core/services/compliance";
export type { ImpactReportView, SelfIdInvite } from "@resumerank/core/services/fairness";

/** Null for people who can't change the workspace's AI policy. */
export async function getAiPolicy(): Promise<compliance.AiPolicy | null> {
  const user = await requireUser();
  if (!user.companyId || !canAdmin(user.role)) return null;
  return compliance.getAiPolicy(tenantContext({ ...user, companyId: user.companyId }));
}

export async function getImpactReport(jobId: string | undefined): Promise<fairness.ImpactReportView> {
  const admin = await requireAdmin();
  return fairness.getImpactReport(tenantContext(admin), { jobId });
}

/** Public: resolves a candidate's signed self-identification link. */
export async function getSelfIdInvite(token: string): Promise<fairness.SelfIdInvite | null> {
  return fairness.getSelfIdInvite(token);
}

/** Public: a company's AI notice for candidates. */
export async function getPublicAiNotice(slug: string): Promise<compliance.PublicAiNotice | null> {
  return compliance.getPublicAiNotice(slug);
}

export async function exportCandidateData(candidateId: string): Promise<dataRights.CandidateDataExport> {
  const admin = await requireAdmin();
  return dataRights.exportCandidateData(tenantContext(admin), candidateId);
}

export type { CandidateRetention } from "@resumerank/core/services/data-rights";

/** Null for people who can't see the workspace's retention policy. */
export async function getCandidateRetention(): Promise<dataRights.CandidateRetention | null> {
  const user = await requireUser();
  if (!user.companyId || !canAdmin(user.role)) return null;
  return dataRights.getCandidateRetention(tenantContext({ ...user, companyId: user.companyId }));
}

export async function exportWorkspace(): Promise<offboarding.WorkspaceExport> {
  const admin = await requireAdmin();
  return offboarding.exportWorkspace(tenantContext(admin));
}
