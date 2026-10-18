import { connection } from "next/server";

import { siteUrl, VULNERABILITY_REPORT_URL } from "@/lib/site";

// RFC 9116 wants Expires less than a year out; a rolling window keeps the file
// valid without anyone having to remember to bump it.
const EXPIRES_IN_DAYS = 180;

/** RFC 9116 security.txt: where to report a vulnerability, for scanners and researchers. */
export async function GET(): Promise<Response> {
  await connection();
  const base = siteUrl();
  const expires = new Date(Date.now() + EXPIRES_IN_DAYS * 86_400_000);
  expires.setUTCHours(0, 0, 0, 0);

  const body = [
    `Contact: ${VULNERABILITY_REPORT_URL}`,
    `Expires: ${expires.toISOString().replace(".000Z", "Z")}`,
    `Policy: ${base}/security#disclosure`,
    `Canonical: ${base}/.well-known/security.txt`,
    "Preferred-Languages: en",
    "",
  ].join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
