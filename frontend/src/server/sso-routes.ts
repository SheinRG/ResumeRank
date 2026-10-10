import { NextResponse } from "next/server";

import { errorFields, log } from "@resumerank/core/observability/log";
import { jacksonStatus } from "@resumerank/core/sso/jackson";

/**
 * Shared plumbing for the /api/oauth/* endpoints the embedded SSO service
 * answers. Browser-facing steps end in a redirect or an auto-submitting form;
 * the token and userinfo steps are server-to-server JSON for Auth.js.
 */

/** A SAML response with a few certificates is tens of kilobytes; anything far beyond is not one. */
const MAX_FORM_BYTES = 1_000_000;

export class PayloadTooLargeError extends Error {}

/** Url-encoded form fields, refusing oversized bodies before reading them whole. */
export async function readForm(request: Request): Promise<Record<string, string>> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_FORM_BYTES) throw new PayloadTooLargeError();
  const body = await request.text();
  if (body.length > MAX_FORM_BYTES) throw new PayloadTooLargeError();
  return Object.fromEntries(new URLSearchParams(body));
}

export function queryParams(request: Request): Record<string, string> {
  return Object.fromEntries(new URL(request.url).searchParams);
}

const NO_STORE = { "Cache-Control": "no-store" };

export function htmlPage(html: string): Response {
  return new Response(html, {
    headers: { ...NO_STORE, "Content-Type": "text/html; charset=utf-8" },
  });
}

export function redirectTo(url: string): Response {
  return new Response(null, { status: 302, headers: { ...NO_STORE, Location: url } });
}

/** Send the person back to log in with an explanation, never a raw stack or SAML error. */
export function browserFailure(request: Request, step: string, error: unknown): Response {
  log.warn("sso.step_failed", { step, status: jacksonStatus(error), ...errorFields(error) });
  return redirectTo(new URL("/login?error=SsoFailed", request.url).toString());
}

/** A request this endpoint refuses before the SSO service sees it. */
export function jsonRejection(step: string, status: 400 | 401, reason: string): Response {
  log.warn("sso.step_rejected", { step, status, reason });
  return NextResponse.json({ error: "invalid_request" }, { status, headers: NO_STORE });
}

/** OAuth-style JSON error for the server-to-server steps. */
export function jsonFailure(step: string, error: unknown): Response {
  const status = jacksonStatus(error);
  log.warn("sso.step_failed", { step, status, ...errorFields(error) });
  const safeStatus = status >= 400 && status < 500 ? status : 500;
  return NextResponse.json(
    { error: safeStatus === 500 ? "server_error" : "invalid_request" },
    { status: safeStatus, headers: NO_STORE },
  );
}

export function json(body: unknown): Response {
  return NextResponse.json(body, { headers: NO_STORE });
}
