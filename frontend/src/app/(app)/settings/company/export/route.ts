import { NextResponse } from "next/server";

import { GateError, requireRecentAuth } from "@/lib/auth/guards";
import { ForbiddenError } from "@resumerank/core/services/errors";
import { exportWorkspace } from "@/server/queries/compliance";

/** Everything the workspace holds, as JSON Lines: the first half of offboarding. */
export async function GET(): Promise<Response> {
  let result: Awaited<ReturnType<typeof exportWorkspace>>;
  try {
    // The whole workspace leaves the app here: only after a step-up, checked again here.
    await requireRecentAuth();
    result = await exportWorkspace();
  } catch (error) {
    if (error instanceof GateError || error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }

  return new Response(result.stream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
