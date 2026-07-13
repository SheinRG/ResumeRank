/**
 * Canonical public site URL. Read directly (this is a NEXT_PUBLIC_ var, safe
 * on the client) rather than through env() so metadata files that run at
 * build time never depend on the full server env contract.
 */
export function siteUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}
