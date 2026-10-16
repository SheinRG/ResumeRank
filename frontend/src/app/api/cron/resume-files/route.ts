import { connection, NextResponse } from "next/server";

import { drainResumeQueue } from "@resumerank/core/ingestion/queue";
import { rejectUnlessCron } from "@/server/cron-auth";

export const maxDuration = 60;

/** Scheduled sweep for resume files nobody is watching: retries whose backoff has elapsed, and files a dead worker left. */
export async function GET(request: Request): Promise<Response> {
  // Without this the build prerenders the "no secret" 404 as a static file.
  await connection();
  const rejected = rejectUnlessCron(request);
  if (rejected) return rejected;

  const { processed } = await drainResumeQueue();
  return NextResponse.json({ processed }, { headers: { "Cache-Control": "no-store" } });
}
