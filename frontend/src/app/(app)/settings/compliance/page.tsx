import type { Metadata } from "next";

import { AiPolicyCard } from "@/components/compliance/ai-policy-card";
import { CandidateRetentionCard } from "@/components/compliance/candidate-retention-card";
import { ImpactReport } from "@/components/compliance/impact-report";
import { EmptyState } from "@/components/shared/empty-state";
import { requireUser } from "@/lib/auth/guards";
import { getAiPolicy, getCandidateRetention, getImpactReport } from "@/server/queries/compliance";
import { listJobOptions } from "@/server/queries/jobs";

export const metadata: Metadata = { title: "Compliance · Settings" };

export default async function SettingsCompliancePage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string | string[] }>;
}) {
  const { job } = await searchParams;
  const jobId = typeof job === "string" && job.length > 0 ? job : null;

  const [user, policy, retention] = await Promise.all([requireUser(), getAiPolicy(), getCandidateRetention()]);
  if (!policy || !retention) {
    return (
      <EmptyState
        title="Admins only"
        description="The AI policy and the impact ratio report are managed by your workspace's admins."
      />
    );
  }

  const jobs = await listJobOptions();
  // A stale or foreign job id in the URL falls back to every job instead of an error page.
  const scope = jobs.some((option) => option.id === jobId) ? jobId : null;
  const report = await getImpactReport(scope ?? undefined);
  return (
    <div className="flex flex-col gap-6">
      <AiPolicyCard policy={policy} />
      <CandidateRetentionCard retentionDays={retention.retentionDays} canChange={user.role === "OWNER"} />
      <ImpactReport report={report} jobs={jobs} jobId={scope} />
    </div>
  );
}
