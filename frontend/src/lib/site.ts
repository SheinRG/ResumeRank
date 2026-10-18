/**
 * Canonical public site URL. Read directly (this is a NEXT_PUBLIC_ var, safe
 * on the client) rather than through env() so metadata files that run at
 * build time never depend on the full server env contract.
 */
export function siteUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

/** The public source repository; vulnerability reports go to its private advisory form. */
export const REPOSITORY_URL = "https://github.com/SheinRG/ResumeRank";

export const VULNERABILITY_REPORT_URL = `${REPOSITORY_URL}/security/advisories/new`;
