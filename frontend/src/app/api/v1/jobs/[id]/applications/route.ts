import { apiList, applicationSummary } from "@resumerank/core/api/serialize";
import { listApplicationsForJob } from "@resumerank/core/services/applications";
import { NotFoundError } from "@resumerank/core/services/errors";
import { getJob } from "@resumerank/core/services/jobs";
import { applicationListParamsSchema } from "@resumerank/core/validators/search";
import { handleApi, readQuery } from "@/server/api-route";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  return handleApi(request, "applications:read", async (ctx) => {
    // An unreachable job answers 404 rather than an empty list, as in the app.
    if (!(await getJob(ctx, id))) throw new NotFoundError("This job no longer exists.");
    const page = await listApplicationsForJob(ctx, id, readQuery(request, applicationListParamsSchema));
    return { body: apiList(page, (item) => applicationSummary(id, item)) };
  });
}
