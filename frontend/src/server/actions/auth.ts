"use server";

import { headers } from "next/headers";
import { AuthError, CredentialsSignin } from "next-auth";
import { db } from "@resumerank/core/db";
import { signIn, signOut, SSO_REQUIRED, TOO_MANY_LOGIN_ATTEMPTS } from "@/lib/auth";
import { hashPassword } from "@resumerank/core/auth/password";
import { withUniqueCompanySlug } from "@resumerank/core/company";
import {
  consumePasswordResetToken,
  consumeVerificationToken,
  createPasswordResetToken,
  createVerificationToken,
} from "@resumerank/core/auth/tokens";
import { queuePasswordResetEmail, queueVerificationEmail } from "@resumerank/core/email/messages";
import { loginBlocked } from "@resumerank/core/auth/login-throttle";
import { AUTH_LIMIT, rateLimit } from "@resumerank/core/rate-limit";
import { clientIp as resolveClientIp } from "@resumerank/core/request-ip";
import {
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
} from "@resumerank/core/validators/auth";
import { registerCompanySchema } from "@resumerank/core/validators/company";
import { scheduleEmailDrain } from "@/server/email-drain";
import { runAction } from "@/server/run-action";
import { actionError, actionOk, type ActionResult } from "@resumerank/core/types/action";

async function clientIp(): Promise<string> {
  return resolveClientIp(await headers());
}

function tooManyLoginAttempts(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `Too many sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}, or reset your password.`;
}

function tooManyAttempts(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

export async function registerAction(
  input: unknown,
): Promise<ActionResult<{ email: string }>> {
  return runAction("register", async () => {
    const parsed = registerCompanySchema.safeParse(input);
    if (!parsed.success) {
      return actionError(
        "Check the highlighted fields.",
        parsed.error.flatten().fieldErrors,
      );
    }
    const { name, email, password, companyName } = parsed.data;

    const ip = await clientIp();
    const limited = await rateLimit(`register:${ip}`, AUTH_LIMIT);
    if (!limited.allowed) {
      return actionError(tooManyAttempts(limited.retryAfterSeconds));
    }

    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
      return actionError("An account with this email already exists.", {
        email: ["An account with this email already exists."],
      });
    }

    const passwordHash = await hashPassword(password);
    await withUniqueCompanySlug(companyName, (slug) =>
      db.$transaction(async (tx) => {
        const company = await tx.company.create({
          data: { name: companyName, slug },
        });
        await tx.user.create({
          data: {
            name,
            email,
            passwordHash,
            role: "OWNER",
            companyId: company.id,
          },
        });
        const token = await createVerificationToken(email, tx);
        await queueVerificationEmail(email, token, tx);
      }),
    );
    scheduleEmailDrain();

    return actionOk({ email });
  });
}

export async function loginAction(
  input: unknown,
): Promise<ActionResult<undefined>> {
  return runAction("login", async () => {
    const parsed = loginSchema.safeParse(input);
    if (!parsed.success) {
      return actionError(
        "Check the highlighted fields.",
        parsed.error.flatten().fieldErrors,
      );
    }

    // authorize() enforces the limits; these read-only checks only let the
    // form say how long to wait instead of a generic failure.
    const ip = await clientIp();
    const blocked = await loginBlocked(parsed.data.email, ip);
    if (!blocked.allowed) {
      return actionError(tooManyLoginAttempts(blocked.retryAfterSeconds));
    }

    try {
      await signIn("credentials", {
        email: parsed.data.email,
        password: parsed.data.password,
        redirect: false,
      });
    } catch (error) {
      if (error instanceof CredentialsSignin && error.code === TOO_MANY_LOGIN_ATTEMPTS) {
        const { retryAfterSeconds } = await loginBlocked(parsed.data.email, ip);
        return actionError(tooManyLoginAttempts(retryAfterSeconds));
      }
      if (error instanceof CredentialsSignin && error.code === SSO_REQUIRED) {
        return actionError("Your company requires single sign-on. Use “Continue with SSO” instead.");
      }
      if (error instanceof AuthError) {
        return actionError("Wrong email or password.");
      }
      throw error;
    }
    return actionOk(undefined);
  });
}

export async function logoutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}

function safeRedirectTarget(next: string | undefined): string {
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return "/dashboard";
}

export async function signInWithGoogleAction(next?: string): Promise<void> {
  await signIn("google", { redirectTo: safeRedirectTarget(next) });
}

export async function verifyEmailAction(
  email: string,
  token: string,
): Promise<ActionResult<undefined>> {
  return runAction("verifyEmail", async () => {
    const ok = await consumeVerificationToken(email, token);
    if (!ok) {
      return actionError(
        "This verification link is invalid or has expired. Request a new one below.",
      );
    }
    return actionOk(undefined);
  });
}

export async function resendVerificationAction(
  input: unknown,
): Promise<ActionResult<undefined>> {
  return runAction("resendVerification", async () => {
    const parsed = forgotPasswordSchema.safeParse(input);
    if (!parsed.success) return actionError("Enter a valid email address.");
    const { email } = parsed.data;

    const ip = await clientIp();
    const limited = await rateLimit(`verify:${ip}:${email}`, AUTH_LIMIT);
    if (!limited.allowed) {
      return actionError(tooManyAttempts(limited.retryAfterSeconds));
    }

    const user = await db.user.findUnique({ where: { email } });
    // Always report success so this endpoint can't be used to probe accounts.
    if (user && !user.emailVerified) {
      await db.$transaction(async (tx) => {
        const token = await createVerificationToken(email, tx);
        await queueVerificationEmail(email, token, tx);
      });
      scheduleEmailDrain();
    }
    return actionOk(undefined);
  });
}

export async function forgotPasswordAction(
  input: unknown,
): Promise<ActionResult<undefined>> {
  return runAction("forgotPassword", async () => {
    const parsed = forgotPasswordSchema.safeParse(input);
    if (!parsed.success) return actionError("Enter a valid email address.");
    const { email } = parsed.data;

    const ip = await clientIp();
    const limited = await rateLimit(`reset:${ip}:${email}`, AUTH_LIMIT);
    if (!limited.allowed) {
      return actionError(tooManyAttempts(limited.retryAfterSeconds));
    }

    const user = await db.user.findUnique({ where: { email } });
    if (user) {
      await db.$transaction(async (tx) => {
        const token = await createPasswordResetToken(user.id, tx);
        await queuePasswordResetEmail(email, token, tx);
      });
      scheduleEmailDrain();
    }
    return actionOk(undefined);
  });
}

export async function resetPasswordAction(
  input: unknown,
): Promise<ActionResult<undefined>> {
  return runAction("resetPassword", async () => {
    const parsed = resetPasswordSchema.safeParse(input);
    if (!parsed.success) {
      return actionError(
        "Check the highlighted fields.",
        parsed.error.flatten().fieldErrors,
      );
    }

    const userId = await consumePasswordResetToken(parsed.data.token);
    if (!userId) {
      return actionError(
        "This reset link is invalid, expired, or already used. Request a new one.",
      );
    }

    // A reset usually means the old password is compromised, so every session
    // signed in with it is revoked.
    await db.user.update({
      where: { id: userId },
      data: {
        passwordHash: await hashPassword(parsed.data.password),
        sessionVersion: { increment: 1 },
      },
    });
    return actionOk(undefined);
  });
}
