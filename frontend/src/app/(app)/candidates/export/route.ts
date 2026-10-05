import { NextResponse } from "next/server";

import { candidateListParamsSchema } from "@resumerank/core/validators/search";
import { GateError } from "@/lib/auth/guards";
import { exportCandidatesCsv } from "@/server/queries/candidates";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const params = candidateListParamsSchema.parse({
    q: url.searchParams.get("q") ?? undefined,
    source: url.searchParams.get("source") ?? undefined,
    sort: url.searchParams.get("sort") ?? undefined,
  });

  let stream: ReadableStream<Uint8Array>;
  try {
    ({ stream } = await exportCandidatesCsv(params));
  } catch (error) {
    if (error instanceof GateError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }

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
