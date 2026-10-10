import { randomBytes } from "node:crypto";
import { resolveTxt } from "node:dns/promises";

/** Looks up TXT records; injectable so verification is testable without DNS. */
export type TxtResolver = (hostname: string) => Promise<string[][]>;

const RECORD_PREFIX = "_resumerank-challenge";
const VALUE_PREFIX = "resumerank-domain-verification=";

export function newVerificationToken(): string {
  return randomBytes(16).toString("hex");
}

/** A dedicated subdomain, so the record never crowds the apex's SPF/DMARC TXT set. */
export function verificationRecordName(domain: string): string {
  return `${RECORD_PREFIX}.${domain}`;
}

export function verificationRecordValue(token: string): string {
  return `${VALUE_PREFIX}${token}`;
}

export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 1 || at === email.length - 1) return null;
  return email.slice(at + 1).trim().toLowerCase().replace(/\.$/, "");
}

/**
 * True once the challenge record is published. Long TXT values arrive split
 * into chunks, so each record is rejoined before comparing. Any lookup
 * failure (no record yet, NXDOMAIN, a flaky resolver) reads as "not yet".
 */
export async function hasVerificationRecord(
  domain: string,
  token: string,
  resolve: TxtResolver = resolveTxt,
): Promise<boolean> {
  const expected = verificationRecordValue(token);
  try {
    const records = await resolve(verificationRecordName(domain));
    return records.some((chunks) => chunks.join("").trim() === expected);
  } catch {
    return false;
  }
}
