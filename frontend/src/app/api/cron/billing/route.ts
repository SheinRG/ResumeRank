import { connection, NextResponse } from "next/server";

import { reportAiUsage } from "@resumerank/core/billing/metering";
import { rejectUnlessCron } from "@/server/cron-auth";

export const maxDuration = 60;

/** Reports finished scoring runs' tokens to the Stripe meter; hourly is plenty. */
export async function GET(request: Request): Promise<Response> {
  // Without this the build prerenders the "no secret" 404 as a static file.
  await connection();
  const rejected = rejectUnlessCron(request);
  if (rejected) return rejected;

  const { reported } = await reportAiUsage();
  return NextResponse.json({ reported }, { headers: { "Cache-Control": "no-store" } });
}
