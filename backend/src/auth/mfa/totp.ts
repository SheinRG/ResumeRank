import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Steps either side of now that still count, for clock drift and typing time. */
const DRIFT_STEPS = 1;
/** RFC 4226 recommends 160 bits, the size of an HMAC-SHA-1 key. */
const SECRET_BYTES = 20;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateTotpSecret(): Buffer {
  return randomBytes(SECRET_BYTES);
}

/** RFC 4648 base32 without padding: what authenticator apps accept for manual entry. */
export function base32(bytes: Buffer): string {
  let bits = 0;
  let buffer = 0;
  let output = "";
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET.charAt((buffer >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET.charAt((buffer << (5 - bits)) & 31);
  return output;
}

export function timeStep(nowMs: number): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);
}

/** RFC 4226 HOTP over HMAC-SHA-1, the only variant every authenticator app supports. */
export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", secret).update(message).digest();
  const offset = digest.readUInt8(digest.length - 1) & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/**
 * The time step `code` was generated for, or null. Steps at or before
 * `lastUsedStep` are refused, so a code works once even if someone saw it
 * over a shoulder.
 */
export function matchTotp(
  secret: Buffer,
  code: string,
  nowMs: number,
  lastUsedStep: number | null,
): number | null {
  if (!/^\d+$/.test(code) || code.length !== TOTP_DIGITS) return null;
  const given = Buffer.from(code);
  const current = timeStep(nowMs);
  for (let step = current - DRIFT_STEPS; step <= current + DRIFT_STEPS; step += 1) {
    if (lastUsedStep !== null && step <= lastUsedStep) continue;
    if (timingSafeEqual(Buffer.from(hotp(secret, step)), given)) return step;
  }
  return null;
}

/** The `otpauth://` URI an authenticator app reads from the enrollment QR code. */
export function totpUri({ secret, issuer, account }: { secret: Buffer; issuer: string; account: string }): string {
  const params = new URLSearchParams({
    secret: base32(secret),
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?${params.toString()}`;
}
