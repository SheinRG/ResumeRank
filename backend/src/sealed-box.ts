import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const VERSION = "v1";
const IV_BYTES = 12;

/** A 256-bit key for one purpose, so no two features ever share key material. */
export function subkey(secret: string, info: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, Buffer.alloc(0), info, 32));
}

/**
 * AES-256-GCM. The associated data names where the box is stored (its row,
 * its owner), so a box copied anywhere else fails to open instead of being
 * accepted there.
 */
export function seal(plaintext: string, associatedData: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(associatedData, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), ciphertext]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}

/** Null for anything that doesn't authenticate: tampering, a moved box, or a rotated key. */
export function open(sealed: string, associatedData: string, key: Buffer): string | null {
  const [version, iv, tag, ciphertext, ...rest] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || !ciphertext || rest.length > 0) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(associatedData, "utf8"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
