import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

import { z } from "zod";

const VERSION = "v1";
const KEY_INFO = "resumerank:email-outbox:v1";
const IV_BYTES = 12;

const sealedEmailSchema = z.object({
  subject: z.string(),
  html: z.string(),
  actionUrl: z.string(),
});

export type SealedEmailContent = z.infer<typeof sealedEmailSchema>;

/** A dedicated subkey, so the outbox never shares key material with session signing. */
export function outboxKey(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, Buffer.alloc(0), KEY_INFO, 32));
}

/**
 * The message id and recipient are bound in as associated data: a payload
 * copied to another row, or a row whose `to` was edited to redirect a reset
 * link, fails to open instead of delivering.
 */
function associatedData(messageId: string, to: string): Buffer {
  return Buffer.from(`${messageId}\n${to}`, "utf8");
}

export function sealEmail(content: SealedEmailContent, messageId: string, to: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(associatedData(messageId, to));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(content), "utf8"), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), ciphertext]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}

/** Null for anything that doesn't authenticate: tampering, another row's payload, or a rotated AUTH_SECRET. */
export function openEmail(sealed: string, messageId: string, to: string, key: Buffer): SealedEmailContent | null {
  const [version, iv, tag, ciphertext, ...rest] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || !ciphertext || rest.length > 0) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAAD(associatedData(messageId, to));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    const parsed = sealedEmailSchema.safeParse(JSON.parse(plaintext));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
