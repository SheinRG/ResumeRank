import { connection } from "next/server";

import { errorFields, log } from "@resumerank/core/observability/log";
import { rateLimit, SCIM_LIMIT } from "@resumerank/core/rate-limit";
import { handleScimRequest } from "@resumerank/core/sso/directory";
import { PayloadTooLargeError, readBody } from "@/server/sso-routes";

/**
 * SCIM 2.0 endpoint an identity provider calls to provision people:
 * /api/scim/v2.0/{directoryId}/Users[/{id}] and /Groups[/{id}]. The
 * directory's bearer token is checked by the directory-sync service against
 * the directory the URL names, and each user change is applied to the
 * workspace before the response goes back.
 */

type ScimContext = { params: Promise<{ directoryId: string; path: string[] }> };

function scimResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body ?? {}), {
    status,
    headers: { "Content-Type": "application/scim+json", "Cache-Control": "no-store" },
  });
}

function scimError(status: number, detail: string): Response {
  return scimResponse(status, {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
    status: String(status),
    detail,
  });
}

function positiveInt(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

async function handle(request: Request, { params }: ScimContext): Promise<Response> {
  await connection();
  const { directoryId, path } = await params;
  const [resourceType, resourceId, ...rest] = path;
  if (!resourceType || rest.length > 0) return scimError(404, "Unknown resource.");

  const header = request.headers.get("authorization") ?? "";
  const apiSecret = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : null;
  if (!apiSecret) return scimError(401, "Unauthorized");

  const limited = await rateLimit(`scim:${directoryId}`, SCIM_LIMIT);
  if (!limited.allowed) return scimError(429, "Too many requests. Retry later.");

  let body: unknown;
  if (request.method === "POST" || request.method === "PUT" || request.method === "PATCH") {
    try {
      const raw = await readBody(request);
      body = raw ? JSON.parse(raw) : undefined;
    } catch (error) {
      if (error instanceof PayloadTooLargeError) return scimError(413, "Request body is too large.");
      return scimError(400, "Request body must be JSON.");
    }
  }

  const query = new URL(request.url).searchParams;
  try {
    const result = await handleScimRequest({
      method: request.method,
      body,
      directoryId,
      resourceType,
      resourceId,
      apiSecret,
      query: {
        count: positiveInt(query.get("count")),
        startIndex: positiveInt(query.get("startIndex")),
        filter: query.get("filter") ?? undefined,
      },
    });
    return scimResponse(result.status, result.data);
  } catch (error) {
    // Usually a failure applying the change here; the IdP retries on a 5xx.
    log.error("scim.request_failed", { directoryId, method: request.method, resourceType, ...errorFields(error) });
    return scimError(500, "The change couldn't be applied. It will be retried.");
  }
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
