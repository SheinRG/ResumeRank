import { NextResponse } from "next/server";

import { GateError, requireMember } from "@/lib/auth/guards";
import { candidateListParamsSchema } from "@resumerank/core/validators/search";
import { exportCandidatesCsv } from "@/server/queries/candidates";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    await requireMember();
  } catch (error) {
    if (error instanceof GateError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
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

  const csv = await exportCandidatesCsv(params);

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="candidates.csv"',
    },
  });
}
