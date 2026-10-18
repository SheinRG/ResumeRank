import { NextResponse } from "next/server";

import { GateError, requireRecentAuth } from "@/lib/auth/guards";
import { NotFoundError } from "@resumerank/core/services/errors";
import { exportCandidateData } from "@/server/queries/compliance";

/** A data-subject access export: everything held about one candidate, as JSON. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  let body: string;
  try {
    // Personal data leaves the app here: the link is only followed after a step-up, and checked again here.
    await requireRecentAuth();
    body = JSON.stringify(await exportCandidateData(id), null, 2);
  } catch (error) {
    if (error instanceof GateError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }

  const date = new Date().toISOString().slice(0, 10);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="candidate-${id}-${date}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
