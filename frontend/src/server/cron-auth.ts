import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { env } from "@resumerank/core/env";

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/**
 * Null when the request carries the scheduler's bearer token, otherwise the
 * response to return. Cron routes are off (404) unless CRON_SECRET is set;
 * the comparison is constant time via fixed-length digests.
 */
export function rejectUnlessCron(request: Request): Response | null {
  const secret = env().CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const presented = request.headers.get("authorization") ?? "";
  if (!timingSafeEqual(digest(presented), digest(`Bearer ${secret}`))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  return null;
}
