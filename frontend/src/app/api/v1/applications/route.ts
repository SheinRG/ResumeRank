import { applicationRecord } from "@resumerank/core/api/serialize";
import { createApplication } from "@resumerank/core/services/applications";
import { apiApplicationCreateSchema } from "@resumerank/core/validators/api";
import { handleApi, readJson } from "@/server/api-route";
import { expireTenantReadsFromRoute } from "@/server/cache-tags";
import { scheduleWebhookDrain } from "@/server/webhook-drain";

export async function POST(request: Request): Promise<Response> {
  return handleApi(request, "applications:write", async (ctx) => {
    const application = await createApplication(ctx, await readJson(request, apiApplicationCreateSchema));
    expireTenantReadsFromRoute(ctx.companyId);
    scheduleWebhookDrain();
    return { status: 201, body: applicationRecord(application) };
  });
}
