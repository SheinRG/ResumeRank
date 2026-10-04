import { NextResponse } from "next/server";

import { GateError } from "@/lib/auth/guards";
import { getJobScoringProgress } from "@/server/queries/scoring";
import { scheduleScoringDrain } from "@/server/scoring-drain";

// The drain scheduled below runs inside this invocation.
export const maxDuration = 60;

/** Polled by the job page while a bulk request is in flight; each poll also nudges the queue. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  try {
    const progress = await getJobScoringProgress(id);
    if (!progress) return NextResponse.json({ error: "Not found." }, { status: 404 });
    if (progress.queued + progress.running > 0) scheduleScoringDrain();
    return NextResponse.json(progress, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof GateError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    throw error;
  }
}
