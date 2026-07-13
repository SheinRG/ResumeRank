import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/jobs",
  "/candidates",
  "/applications",
  "/activity",
  "/settings",
];

const AUTH_PAGES = ["/login", "/register"];

function hasSessionCookie(request: NextRequest): boolean {
  return Boolean(
    request.cookies.get("authjs.session-token") ??
      request.cookies.get("__Secure-authjs.session-token"),
  );
}

/**
 * Optimistic redirect layer only. Real authentication and authorization run
 * server-side in layouts and actions (see src/lib/auth/guards.ts) — a forged
 * cookie gets past this redirect and nothing else.
 */
export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const signedIn = hasSessionCookie(request);

  if (
    !signedIn &&
    PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  ) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (signedIn && AUTH_PAGES.includes(pathname)) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/jobs/:path*",
    "/candidates/:path*",
    "/applications/:path*",
    "/activity/:path*",
    "/settings/:path*",
    "/login",
    "/register",
  ],
};
