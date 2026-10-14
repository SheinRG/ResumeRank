import { scoringRequest } from "@resumerank/core/api/serialize";
import { requestScoring } from "@resumerank/core/services/scoring";
import { handleApi } from "@/server/api-route";
import { scheduleScoringDrain } from "@/server/scoring-drain";

// The drain scheduled below runs inside this invocation.
export const maxDuration = 60;

/** Queues a scoring run and answers 202; `application.scored` reports the result. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  return handleApi(request, "scoring:write", async (ctx) => {
    const result = await requestScoring(ctx, id);
    if (result.outcome !== "reused") scheduleScoringDrain();
    return { status: 202, body: scoringRequest(result) };
  });
}
