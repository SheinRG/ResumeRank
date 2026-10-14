import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * `rr_<keyId>_<secret>`. The id finds the row without scanning; the secret
 * (256 random bits) is checked against a SHA-256 hash, which is enough for a
 * value no one can guess, unlike a password that needs a slow hash.
 */
const TOKEN_PATTERN = /^rr_([a-z0-9]{20,40})_([A-Za-z0-9_-]{43})$/;
const PREFIX_LENGTH = 12;

export interface GeneratedApiToken {
  id: string;
  token: string;
  prefix: string;
  secretHash: string;
}

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** cuid-shaped, so key ids look like every other id in the API. */
function newKeyId(): string {
  return `k${randomBytes(15).toString("hex")}`;
}

export function generateApiToken(): GeneratedApiToken {
  const id = newKeyId();
  const secret = randomBytes(32).toString("base64url");
  const token = `rr_${id}_${secret}`;
  return { id, token, prefix: token.slice(0, PREFIX_LENGTH), secretHash: hashSecret(secret) };
}

export function parseApiToken(token: string): { id: string; secret: string } | null {
  const match = TOKEN_PATTERN.exec(token);
  if (!match?.[1] || !match[2]) return null;
  return { id: match[1], secret: match[2] };
}

export function secretMatches(secret: string, storedHash: string): boolean {
  const presented = Buffer.from(hashSecret(secret), "hex");
  const stored = Buffer.from(storedHash, "hex");
  return presented.length === stored.length && timingSafeEqual(presented, stored);
}
