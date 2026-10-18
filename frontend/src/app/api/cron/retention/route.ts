import { connection, NextResponse } from "next/server";

import { purgeExpiredCandidates } from "@resumerank/core/retention/candidates";
import { rejectUnlessCron } from "@/server/cron-auth";

export const maxDuration = 60;

/** Applies each company's candidate retention period. Daily is enough; each run clears a bounded batch. */
export async function GET(request: Request): Promise<Response> {
  // Without this the build prerenders the "no secret" 404 as a static file.
  await connection();
  const rejected = rejectUnlessCron(request);
  if (rejected) return rejected;

  const { deleted } = await purgeExpiredCandidates();
  return NextResponse.json({ deleted }, { headers: { "Cache-Control": "no-store" } });
}
