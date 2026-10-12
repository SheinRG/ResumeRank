import { connection, NextResponse } from "next/server";

import { purgeExpiredAuditEntries } from "@resumerank/core/audit/retention";
import { drainAuditStreams } from "@resumerank/core/audit/stream";
import { rejectUnlessCron } from "@/server/cron-auth";

export const maxDuration = 60;

/**
 * The audit log's scheduled work: applies each company's retention period,
 * then delivers new entries to every connected SIEM stream. Streams only
 * move here, so schedule it every minute.
 */
export async function GET(request: Request): Promise<Response> {
  // Without this the build prerenders the "no secret" 404 as a static file.
  await connection();
  const rejected = rejectUnlessCron(request);
  if (rejected) return rejected;

  const { deleted } = await purgeExpiredAuditEntries();
  const { delivered } = await drainAuditStreams();
  return NextResponse.json({ deleted, delivered }, { headers: { "Cache-Control": "no-store" } });
}
