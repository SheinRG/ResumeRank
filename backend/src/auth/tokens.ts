import { createHash, randomBytes } from "crypto";
import { db } from "../db";
import type { CompanyInvite } from "../generated/prisma/client";
import type { Role } from "../generated/prisma/enums";

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 30 * 60 * 1000;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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

interface CreateCompanyInviteInput {
  companyId: string;
  email: string;
  role: Role;
  invitedById: string;
}

/**
 * Re-inviting the same email replaces the pending invite rather than
 * accumulating rows — the unique [companyId, email] constraint means this is
 * an upsert, and resetting expiresAt/acceptedAt makes a stale accepted or
 * expired invite usable again under a fresh link.
 */
export async function createCompanyInvite(
  input: CreateCompanyInviteInput,
): Promise<{ invite: CompanyInvite; rawToken: string }> {
  const raw = generateToken();
  const invite = await db.companyInvite.upsert({
    where: { companyId_email: { companyId: input.companyId, email: input.email } },
    create: {
      companyId: input.companyId,
      email: input.email,
      role: input.role,
      invitedById: input.invitedById,
      tokenHash: sha256(raw),
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    },
    update: {
      role: input.role,
      invitedById: input.invitedById,
      tokenHash: sha256(raw),
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      acceptedAt: null,
    },
  });
  return { invite, rawToken: raw };
}

export async function consumeInviteToken(
  rawToken: string,
): Promise<CompanyInvite | null> {
  const invite = await db.companyInvite.findUnique({
    where: { tokenHash: sha256(rawToken) },
  });
  if (!invite || invite.acceptedAt !== null || invite.expiresAt < new Date()) {
    return null;
  }
  return invite;
}
