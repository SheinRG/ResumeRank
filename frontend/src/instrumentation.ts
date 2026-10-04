import { registerOTel } from "@vercel/otel";
import type { Instrumentation } from "next";

/**
 * Next.js and the backend's LLM spans report through OpenTelemetry. On Vercel
 * the traces reach any connected observability integration; elsewhere set
 * OTEL_EXPORTER_OTLP_ENDPOINT to ship them to a collector.
 */
export function register(): void {
  registerOTel({ serviceName: "resumerank" });
}

function digestOf(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "digest" in error) {
    return String(error.digest);
  }
  return undefined;
}

/**
 * One structured line per server error, keyed by the same digest the error
 * boundary shows the user as a support reference. The query string and
 * headers are left out: they carry search terms, cookies and tokens.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { errorFields, log } = await import("@resumerank/core/observability/log");
  log.error("request.error", {
    digest: digestOf(error),
    method: request.method,
    path: request.path.split("?")[0],
    routePath: context.routePath,
    routeType: context.routeType,
    renderSource: context.renderSource,
    ...errorFields(error),
  });
};
