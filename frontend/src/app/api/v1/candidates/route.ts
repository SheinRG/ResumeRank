import { apiList, candidateRecord, candidateSummary } from "@resumerank/core/api/serialize";
import { createCandidate, listCandidates } from "@resumerank/core/services/candidates";
import { candidateCreateSchema } from "@resumerank/core/validators/candidate";
import { candidateListParamsSchema } from "@resumerank/core/validators/search";
import { handleApi, readJson, readQuery } from "@/server/api-route";
import { expireTenantReadsFromRoute } from "@/server/cache-tags";

export async function GET(request: Request): Promise<Response> {
  return handleApi(request, "candidates:read", async (ctx) => {
    const page = await listCandidates(ctx, readQuery(request, candidateListParamsSchema));
    return { body: apiList(page, candidateSummary) };
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleApi(request, "candidates:write", async (ctx) => {
    const candidate = await createCandidate(ctx, await readJson(request, candidateCreateSchema));
    expireTenantReadsFromRoute(ctx.companyId);
    return { status: 201, body: candidateRecord(candidate) };
  });
}
