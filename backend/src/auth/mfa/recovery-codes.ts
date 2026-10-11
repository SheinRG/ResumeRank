import { createHash, randomBytes } from "node:crypto";

import { normalizeRecoveryCode } from "../../validators/mfa";
import { base32 } from "./totp";

export const RECOVERY_CODE_COUNT = 10;
/** 80 bits each, so the stored hashes need no salt or slow hash to resist guessing offline. */
const CODE_BYTES = 10;
const GROUP_LENGTH = 4;

/** Lowercase base32, in dash-separated groups of four: easy to read aloud and type. */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => {
    const code = base32(randomBytes(CODE_BYTES)).toLowerCase();
    return code.match(new RegExp(`.{1,${GROUP_LENGTH}}`, "g"))?.join("-") ?? code;
  });
}

export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(normalizeRecoveryCode(code)).digest("hex");
}
