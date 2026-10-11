/** A same-site path to return to after sign-in; anything else (absolute or protocol-relative URLs) falls back to the dashboard. */
export function safeNext(next: string | undefined): string {
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return "/dashboard";
}
