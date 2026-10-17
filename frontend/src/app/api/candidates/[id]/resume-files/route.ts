import { NextResponse } from "next/server";

import { GateError } from "@/lib/auth/guards";
import { listResumeFiles } from "@/server/queries/resume-files";
import { scheduleResumeDrain } from "@/server/resume-drain";

// The drain scheduled below runs inside this invocation.
export const maxDuration = 60;

/** Polled by the candidate page while a file is being read; each poll also nudges the queue. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  try {
    const files = await listResumeFiles(id);
    if (files.some((file) => file.status === "QUEUED" || file.status === "RUNNING")) scheduleResumeDrain();
    return NextResponse.json(
      files.map(({ id: fileId, status, error }) => ({ id: fileId, status, error })),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof GateError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    throw error;
  }
}
