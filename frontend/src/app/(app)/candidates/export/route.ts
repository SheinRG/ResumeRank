import { NextResponse } from "next/server";

import { logActivity } from "@resumerank/core/activity";
import { candidateListParamsSchema } from "@resumerank/core/validators/search";
import { GateError, requireWriter, type CompanyUser } from "@/lib/auth/guards";
import { exportCandidatesCsv } from "@/server/queries/candidates";

export async function GET(request: Request): Promise<Response> {
  let user: CompanyUser;
  try {
    user = await requireWriter();
  } catch (error) {
    if (error instanceof GateError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }

  const url = new URL(request.url);
  const params = candidateListParamsSchema.parse({
    q: url.searchParams.get("q") ?? undefined,
    source: url.searchParams.get("source") ?? undefined,
    sort: url.searchParams.get("sort") ?? undefined,
    page: url.searchParams.get("page") ?? undefined,
  });

  const { rowCount, stream } = await exportCandidatesCsv(params);

  // Logged before the body streams: a bulk PII download must leave a trail
  // even if the client abandons it midway.
  await logActivity({
    companyId: user.companyId,
    actorId: user.id,
    action: "candidate.export",
    entityType: "candidate",
    entityId: user.companyId,
    summary: `exported ${rowCount} candidate${rowCount === 1 ? "" : "s"} to CSV`,
    metadata: { rowCount, q: params.q || null, source: params.source ?? null },
  });

  const date = new Date().toISOString().slice(0, 10);
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="candidates-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
