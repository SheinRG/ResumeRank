import { apiList, jobSummary } from "@resumerank/core/api/serialize";
import { listJobs } from "@resumerank/core/services/jobs";
import { jobListParamsSchema } from "@resumerank/core/validators/search";
import { handleApi, readQuery } from "@/server/api-route";

export async function GET(request: Request): Promise<Response> {
  return handleApi(request, "jobs:read", async (ctx) => {
    const page = await listJobs(ctx, readQuery(request, jobListParamsSchema));
    return { body: apiList(page, jobSummary) };
  });
}
