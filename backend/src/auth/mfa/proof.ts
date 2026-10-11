import { createHmac, timingSafeEqual } from "node:crypto";

import { env } from "../../env";
import { subkey } from "../../sealed-box";

const KEY_INFO = "resumerank:mfa-proof:v1";
/** Long enough to cover the session refresh that follows a check, too short to be worth stealing. */
const PROOF_TTL_MS = 60_000;

function sign(loginId: string, body: string): Buffer {
  return createHmac("sha256", subkey(env().AUTH_SECRET, KEY_INFO))
    .update(`${loginId}\n${body}`)
    .digest();
}

/**
 * What a server action hands the session callback after a second factor
 * checks out. The browser can ask Auth.js to refresh its session with any
 * payload it likes, so the callback trusts only this: a signature over the
 * one sign-in it was minted for and the MFA epoch (`User.mfaEnabledAt`) it
 * was checked against.
 */
export function mintMfaProof(loginId: string, epoch: number, now = Date.now()): string {
  const body = `${epoch}.${now}`;
  return `${body}.${sign(loginId, body).toString("base64url")}`;
}

/** The epoch a proof vouches for, or null if it is forged, stale, or minted for another sign-in. */
export function readMfaProof(proof: unknown, loginId: string, now = Date.now()): number | null {
  if (typeof proof !== "string") return null;
  const [epochText, issuedText, signature, ...rest] = proof.split(".");
  if (!epochText || !issuedText || !signature || rest.length > 0) return null;

  const expected = sign(loginId, `${epochText}.${issuedText}`);
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  const epoch = Number(epochText);
  const issuedAt = Number(issuedText);
  if (!Number.isSafeInteger(epoch) || !Number.isSafeInteger(issuedAt)) return null;
  if (issuedAt > now || now - issuedAt > PROOF_TTL_MS) return null;
  return epoch;
}
