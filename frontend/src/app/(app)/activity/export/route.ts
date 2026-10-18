import { NextResponse } from "next/server";

import { auditExportParamsSchema } from "@resumerank/core/validators/audit";
import { GateError, requireRecentAuth } from "@/lib/auth/guards";
import { exportAuditLog } from "@/server/queries/audit";

const CONTENT_TYPES = { csv: "text/csv; charset=utf-8", jsonl: "application/x-ndjson; charset=utf-8" } as const;

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const parsed = auditExportParamsSchema.safeParse({
    format: url.searchParams.get("format") ?? "csv",
    from: url.searchParams.get("from") || undefined,
    to: url.searchParams.get("to") || undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid export range." }, { status: 400 });
  }

  let stream: ReadableStream<Uint8Array>;
  try {
    // Bulk personal data: the link is only followed after a step-up, and checked again here.
    await requireRecentAuth();
    ({ stream } = await exportAuditLog(parsed.data));
  } catch (error) {
    if (error instanceof GateError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }

  const date = new Date().toISOString().slice(0, 10);
  const { format } = parsed.data;
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": CONTENT_TYPES[format],
      "Content-Disposition": `attachment; filename="audit-log-${date}.${format}"`,
      "Cache-Control": "no-store",
    },
  });
}
