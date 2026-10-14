import { jobDetail } from "@resumerank/core/api/serialize";
import { NotFoundError } from "@resumerank/core/services/errors";
import { getJob } from "@resumerank/core/services/jobs";
import { handleApi } from "@/server/api-route";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  return handleApi(request, "jobs:read", async (ctx) => {
    const job = await getJob(ctx, id);
    if (!job) throw new NotFoundError("This job no longer exists.");
    return { body: jobDetail(job) };
  });
}
