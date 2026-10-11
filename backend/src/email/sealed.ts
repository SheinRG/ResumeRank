import { z } from "zod";

import { open, seal, subkey } from "../sealed-box";

const KEY_INFO = "resumerank:email-outbox:v1";

const sealedEmailSchema = z.object({
  subject: z.string(),
  html: z.string(),
  actionUrl: z.string(),
});

export type SealedEmailContent = z.infer<typeof sealedEmailSchema>;

/** A dedicated subkey, so the outbox never shares key material with session signing. */
export function outboxKey(secret: string): Buffer {
  return subkey(secret, KEY_INFO);
}

/**
 * The message id and recipient are bound in as associated data: a payload
 * copied to another row, or a row whose `to` was edited to redirect a reset
 * link, fails to open instead of delivering.
 */
function associatedData(messageId: string, to: string): string {
  return `${messageId}\n${to}`;
}

export function sealEmail(content: SealedEmailContent, messageId: string, to: string, key: Buffer): string {
  return seal(JSON.stringify(content), associatedData(messageId, to), key);
}

/** Null for anything that doesn't authenticate: tampering, another row's payload, or a rotated AUTH_SECRET. */
export function openEmail(sealed: string, messageId: string, to: string, key: Buffer): SealedEmailContent | null {
  const plaintext = open(sealed, associatedData(messageId, to), key);
  if (plaintext === null) return null;
  try {
    const parsed = sealedEmailSchema.safeParse(JSON.parse(plaintext));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
