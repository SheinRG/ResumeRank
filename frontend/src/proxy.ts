import { NextResponse, type NextRequest } from "next/server";

import { contentSecurityPolicy, createNonce, NONCE_HEADER } from "@/lib/csp";

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/jobs",
  "/candidates",
  "/applications",
  "/activity",
  "/settings",
  "/onboarding",
  "/mfa",
  "/network-blocked",
  "/password-change",
  "/workspace-suspended",
  "/staff",
];

const AUTH_PAGES = ["/login", "/register"];

function hasSessionCookie(request: NextRequest): boolean {
  return Boolean(
    request.cookies.get("authjs.session-token") ??
      request.cookies.get("__Secure-authjs.session-token"),
  );
}

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Issues each page request its own CSP nonce: Next reads it from the request's
 * policy and stamps it on every script it renders, and the root layout hands
 * it to the theme script.
 *
 * The redirects are an optimistic layer only. Real authentication and
 * authorization run server-side in layouts and actions (see
 * src/lib/auth/guards.ts) — a forged cookie gets past this redirect and
 * nothing else.
 */
export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const signedIn = hasSessionCookie(request);

  if (!signedIn && isProtected(pathname)) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (signedIn && AUTH_PAGES.includes(pathname)) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  const nonce = createNonce();
  const policy = contentSecurityPolicy({ nonce });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(NONCE_HEADER, nonce);
  requestHeaders.set("Content-Security-Policy", policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  // Every page and page data request; API routes and build assets carry the
  // fixed policy from next.config.ts instead.
  matcher: ["/((?!api/|_next/static/|_next/image|favicon.ico).*)"],
};
