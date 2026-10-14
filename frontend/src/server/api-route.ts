import { randomUUID } from "node:crypto";
import { connection, NextResponse } from "next/server";
import type { ZodType } from "zod";

import { authenticateApiKey } from "@resumerank/core/api/auth";
import { errorFields, log, withLogContext } from "@resumerank/core/observability/log";
import { rateLimit, type RateLimit } from "@resumerank/core/rate-limit";
import type { TenantContext } from "@resumerank/core/services/context";
import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
} from "@resumerank/core/services/errors";
import type { ApiScope } from "@resumerank/core/validators/api";

/** Per key, shared by every instance: a sync job can page through a large workspace, a loop can't flood it. */
const API_LIMIT: RateLimit = { max: 600, windowMs: 60_000 };
const MAX_BODY_BYTES = 256 * 1024;

export interface ApiReply {
  status?: number;
  body: unknown;
}

/** A malformed request: answered 400 with the field errors, never logged as a failure. */
export class ApiInputError extends Error {
  constructor(
    message: string,
    readonly details?: Record<string, string[] | undefined>,
  ) {
    super(message);
  }
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  extra: { details?: unknown; headers?: Record<string, string> } = {},
): Response {
  return NextResponse.json(
    { error: { code, message, ...(extra.details ? { details: extra.details } : {}) } },
    { status, headers: { "Cache-Control": "no-store", ...extra.headers } },
  );
}

function domainStatus(error: DomainError): [number, string] {
  if (error instanceof NotFoundError) return [404, "not_found"];
  if (error instanceof ForbiddenError) return [403, "forbidden"];
  if (error instanceof ConflictError) return [409, "conflict"];
  return [422, "unprocessable"];
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match?.[1] ?? null;
}

/**
 * Every `/api/v1` handler runs through here: the key is resolved to a tenant
 * context (never a session, so no cookie can ride along), rate-limited per
 * key, checked for the scope, and the outcome written as one `api` log line.
 * Services re-check the creator's role and job access as they would for the
 * app, so a scope only ever narrows what the key's creator could do.
 */
export async function handleApi(
  request: Request,
  scope: ApiScope,
  run: (ctx: TenantContext) => Promise<ApiReply>,
): Promise<Response> {
  await connection();
  const started = performance.now();
  const route = `${request.method} ${new URL(request.url).pathname}`;

  const token = bearerToken(request);
  const principal = token ? await authenticateApiKey(token) : null;
  if (!principal) {
    log.info("api", { route, status: 401 });
    return errorResponse(401, "unauthorized", "Send a valid API key as `Authorization: Bearer <key>`.", {
      headers: { "WWW-Authenticate": 'Bearer realm="ResumeRank"' },
    });
  }

  return withLogContext({ route, apiKeyId: principal.keyId, companyId: principal.ctx.companyId }, async () => {
    const respond = (response: Response): Response => {
      log.info("api", { status: response.status, durationMs: Math.round(performance.now() - started) });
      return response;
    };

    const limited = await rateLimit(`api:${principal.keyId}`, API_LIMIT);
    if (!limited.allowed) {
      return respond(
        errorResponse(429, "rate_limited", "Too many requests for this key. Slow down and retry.", {
          headers: { "Retry-After": String(limited.retryAfterSeconds) },
        }),
      );
    }
    if (!principal.scopes.includes(scope)) {
      return respond(errorResponse(403, "insufficient_scope", `This key doesn't have the \`${scope}\` permission.`));
    }

    try {
      const { status = 200, body } = await run(principal.ctx);
      return respond(NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } }));
    } catch (error) {
      if (error instanceof ApiInputError) {
        return respond(errorResponse(400, "invalid_request", error.message, { details: error.details }));
      }
      if (error instanceof DomainError) {
        const [status, code] = domainStatus(error);
        return respond(errorResponse(status, code, error.message, { details: error.fieldErrors }));
      }
      const digest = randomUUID().slice(0, 8);
      log.error("api.error", { digest, ...errorFields(error) });
      return respond(errorResponse(500, "internal_error", `Something went wrong on our side. Reference: ${digest}.`));
    }
  });
}

/** Parses a JSON body with the shared schema, or throws a 400. */
export async function readJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) throw new ApiInputError("The request body is too large.");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ApiInputError("The request body must be JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiInputError("Check the fields in `details`.", parsed.error.flatten().fieldErrors);
  }
  return parsed.data;
}

/** Query parameters through a list schema; its `.catch` defaults drop anything malformed. */
export function readQuery<T>(request: Request, schema: ZodType<T>): T {
  return schema.parse(Object.fromEntries(new URL(request.url).searchParams));
}
