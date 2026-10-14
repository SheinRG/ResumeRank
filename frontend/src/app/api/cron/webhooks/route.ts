import { connection, NextResponse } from "next/server";

import { drainWebhooks, purgeSettledDeliveries } from "@resumerank/core/webhooks/delivery";
import { rejectUnlessCron } from "@/server/cron-auth";

export const maxDuration = 60;

/**
 * Webhook retries whose backoff has elapsed, deliveries a crashed drain left
 * behind, and the purge of old settled rows. Schedule it every minute.
 */
export async function GET(request: Request): Promise<Response> {
  // Without this the build prerenders the "no secret" 404 as a static file.
  await connection();
  const rejected = rejectUnlessCron(request);
  if (rejected) return rejected;

  const purged = await purgeSettledDeliveries();
  const { delivered, failed } = await drainWebhooks();
  return NextResponse.json({ delivered, failed, purged }, { headers: { "Cache-Control": "no-store" } });
}
