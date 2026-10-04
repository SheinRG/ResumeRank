import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { env } from "@resumerank/core/env";
import { drainScoringQueue } from "@resumerank/core/scoring/queue";

export const maxDuration = 60;

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/**
 * Scheduled sweep for work nobody is watching: retries whose backoff has
 * elapsed and runs recovered from a dead worker. Off unless CRON_SECRET is
 * set; compared in constant time via fixed-length digests.
 */
export async function GET(request: Request): Promise<Response> {
  const secret = env().CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const presented = request.headers.get("authorization") ?? "";
  if (!timingSafeEqual(digest(presented), digest(`Bearer ${secret}`))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const result = await drainScoringQueue();
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
