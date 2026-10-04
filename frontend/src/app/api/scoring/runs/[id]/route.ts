import { NextResponse } from "next/server";

import { GateError } from "@/lib/auth/guards";
import { getScoringRun } from "@/server/queries/scoring";
import { scheduleScoringDrain } from "@/server/scoring-drain";

// The drain scheduled below runs inside this invocation.
export const maxDuration = 60;

/** Polled by the score button until the run finishes; each poll also nudges the queue. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  try {
    const run = await getScoringRun(id);
    if (!run) return NextResponse.json({ error: "Not found." }, { status: 404 });
    if (run.status === "QUEUED" || run.status === "RUNNING") scheduleScoringDrain();
    return NextResponse.json(run, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof GateError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    throw error;
  }
}
