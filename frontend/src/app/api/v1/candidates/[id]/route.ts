import { candidateDetail } from "@resumerank/core/api/serialize";
import { getCandidate } from "@resumerank/core/services/candidates";
import { NotFoundError } from "@resumerank/core/services/errors";
import { handleApi } from "@/server/api-route";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  return handleApi(request, "candidates:read", async (ctx) => {
    const candidate = await getCandidate(ctx, id);
    if (!candidate) throw new NotFoundError("This candidate no longer exists.");
    return { body: candidateDetail(candidate) };
  });
}
