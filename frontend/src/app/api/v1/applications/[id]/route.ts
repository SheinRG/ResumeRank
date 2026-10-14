import { applicationDetail, applicationRecord } from "@resumerank/core/api/serialize";
import { getApplication, updateStage } from "@resumerank/core/services/applications";
import { NotFoundError } from "@resumerank/core/services/errors";
import { apiApplicationPatchSchema } from "@resumerank/core/validators/api";
import { handleApi, readJson } from "@/server/api-route";
import { expireTenantReadsFromRoute } from "@/server/cache-tags";
import { scheduleWebhookDrain } from "@/server/webhook-drain";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params): Promise<Response> {
  const { id } = await params;
  return handleApi(request, "applications:read", async (ctx) => {
    const application = await getApplication(ctx, id);
    if (!application) throw new NotFoundError("This application no longer exists.");
    return { body: applicationDetail(application) };
  });
}

export async function PATCH(request: Request, { params }: Params): Promise<Response> {
  const { id } = await params;
  return handleApi(request, "applications:write", async (ctx) => {
    const { stage } = await readJson(request, apiApplicationPatchSchema);
    const application = await updateStage(ctx, { id, stage });
    expireTenantReadsFromRoute(ctx.companyId);
    scheduleWebhookDrain();
    return { body: applicationRecord(application) };
  });
}
