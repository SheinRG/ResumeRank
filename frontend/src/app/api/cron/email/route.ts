import { connection, NextResponse } from "next/server";

import { drainEmailOutbox } from "@resumerank/core/email/outbox";
import { rejectUnlessCron } from "@/server/cron-auth";

export const maxDuration = 30;

/**
 * Scheduled sweep of the email outbox: retries whose backoff has elapsed and
 * sends recovered from a dead worker. New mail is sent right after it is
 * queued, so this only carries the stragglers.
 */
export async function GET(request: Request): Promise<Response> {
  // Without this the build prerenders the "no secret" 404 as a static file.
  await connection();
  const rejected = rejectUnlessCron(request);
  if (rejected) return rejected;

  const { processed } = await drainEmailOutbox();
  return NextResponse.json({ processed }, { headers: { "Cache-Control": "no-store" } });
}
