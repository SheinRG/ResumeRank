import { NextResponse } from "next/server";

import { DomainError, NotFoundError } from "@resumerank/core/services/errors";
import { GateError } from "@/lib/auth/guards";
import { getResumeFileDownload } from "@/server/queries/resume-files";

/** RFC 6266: an ASCII fallback plus the exact name, percent-encoded. */
function attachment(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/**
 * The stored original, always as a download: served inline from our origin, a
 * crafted PDF could run in the app's context.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  try {
    const file = await getResumeFileDownload(id);
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": attachment(file.fileName),
        "Content-Length": String(file.bytes.length),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof GateError) return NextResponse.json({ error: error.message }, { status: 401 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    if (error instanceof DomainError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
