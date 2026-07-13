import { createHash, randomBytes } from "crypto";
import { db } from "../db";

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 30 * 60 * 1000;

/** Tokens are stored hashed so a database leak never exposes usable links. */
function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function createVerificationToken(email: string): Promise<string> {
  const raw = generateToken();
  await db.verificationToken.deleteMany({ where: { identifier: email } });
  await db.verificationToken.create({
    data: {
      identifier: email,
      token: sha256(raw),
      expires: new Date(Date.now() + VERIFICATION_TTL_MS),
    },
  });
  return raw;
}

export async function consumeVerificationToken(
  email: string,
  raw: string,
): Promise<boolean> {
  const record = await db.verificationToken.findUnique({
    where: { identifier_token: { identifier: email, token: sha256(raw) } },
  });
  if (!record) return false;
  await db.verificationToken.delete({
    where: { identifier_token: { identifier: email, token: record.token } },
  });
  if (record.expires < new Date()) return false;
  await db.user.update({
    where: { email },
    data: { emailVerified: new Date() },
  });
  return true;
}

export async function createPasswordResetToken(userId: string): Promise<string> {
  const raw = generateToken();
  await db.passwordResetToken.deleteMany({
    where: { userId, usedAt: null },
  });
  await db.passwordResetToken.create({
    data: {
      userId,
      tokenHash: sha256(raw),
      expiresAt: new Date(Date.now() + RESET_TTL_MS),
    },
  });
  return raw;
}

export async function consumePasswordResetToken(
  raw: string,
): Promise<string | null> {
  const record = await db.passwordResetToken.findUnique({
    where: { tokenHash: sha256(raw) },
  });
  if (!record || record.usedAt !== null || record.expiresAt < new Date()) {
    return null;
  }
  await db.passwordResetToken.update({
    where: { id: record.id },
    data: { usedAt: new Date() },
  });
  return record.userId;
}
