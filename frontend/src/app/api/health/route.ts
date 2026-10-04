import { NextResponse } from "next/server";

import { checkDatabase } from "@resumerank/core/health";

/** Public uptime probe: reports only up/down and latency, never why. */
export async function GET(): Promise<Response> {
  const database = await checkDatabase();
  return NextResponse.json(
    { status: database.ok ? "ok" : "unavailable", checks: { database } },
    { status: database.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
