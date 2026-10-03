import { requireMember, tenantContext } from "@/lib/auth/guards";
import * as jobs from "@resumerank/core/services/jobs";
import type { JobListParams } from "@resumerank/core/validators/search";
import type { Paged } from "@resumerank/core/types/paged";

export type {
  JobDetail,
  JobListItem,
  JobOption,
  JobRequirementItem,
} from "@resumerank/core/services/jobs";

export async function listJobs(params: JobListParams): Promise<Paged<jobs.JobListItem>> {
  const user = await requireMember();
  return jobs.listJobs(tenantContext(user), params);
}

export async function getJob(id: string): Promise<jobs.JobDetail | null> {
  const user = await requireMember();
  return jobs.getJob(tenantContext(user), id);
}

export async function listJobOptions(): Promise<jobs.JobOption[]> {
  const user = await requireMember();
  return jobs.listJobOptions(tenantContext(user));
}
