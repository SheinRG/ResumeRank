import { connection, NextResponse } from "next/server";

import { drainScoringQueue } from "@resumerank/core/scoring/queue";
import { expireScoredTenants } from "@/server/cache-tags";
import { rejectUnlessCron } from "@/server/cron-auth";

export const maxDuration = 60;

/**
 * Scheduled sweep for work nobody is watching: retries whose backoff has
 * elapsed and runs recovered from a dead worker.
 */
export async function GET(request: Request): Promise<Response> {
  // Without this the build prerenders the "no secret" 404 as a static file,
  // since that branch never reads the request.
  await connection();
  const rejected = rejectUnlessCron(request);
  if (rejected) return rejected;

  const { processed, companyIds } = await drainScoringQueue();
  expireScoredTenants(companyIds);
  return NextResponse.json({ processed }, { headers: { "Cache-Control": "no-store" } });
}
