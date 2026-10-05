import { NextResponse } from "next/server";

import { candidateOptionParamsSchema } from "@resumerank/core/validators/search";
import { GateError } from "@/lib/auth/guards";
import { searchCandidateOptions } from "@/server/queries/candidates";

/** Typeahead behind the "Add candidate" picker on a job's page. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const query = candidateOptionParamsSchema.parse({
    q: new URL(request.url).searchParams.get("q") ?? undefined,
  });
  try {
    const options = await searchCandidateOptions(id, query);
    return NextResponse.json(options, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof GateError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }
}
