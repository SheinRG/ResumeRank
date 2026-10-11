import { env } from "../../env";
import { open, seal, subkey } from "../../sealed-box";

const KEY_INFO = "resumerank:mfa-totp:v1";

function totpKey(): Buffer {
  const { MFA_ENCRYPTION_KEY, AUTH_SECRET } = env();
  return subkey(MFA_ENCRYPTION_KEY ?? AUTH_SECRET, KEY_INFO);
}

/** Bound to its owner, so a secret copied onto another user's row won't open. */
function associatedData(userId: string): string {
  return `totp\n${userId}`;
}

export function sealTotpSecret(secret: Buffer, userId: string): string {
  return seal(secret.toString("base64url"), associatedData(userId), totpKey());
}

/** Null when the box was tampered with, moved, or sealed under a key that has since rotated. */
export function openTotpSecret(sealed: string, userId: string): Buffer | null {
  const plaintext = open(sealed, associatedData(userId), totpKey());
  return plaintext === null ? null : Buffer.from(plaintext, "base64url");
}
