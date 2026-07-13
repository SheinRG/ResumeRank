"use server";

import { headers } from "next/headers";
import { AuthError } from "next-auth";
import { db } from "@resumerank/core/db";
import { signIn, signOut } from "@/lib/auth";
import { hashPassword } from "@resumerank/core/auth/password";
import {
  consumePasswordResetToken,
  consumeVerificationToken,
  createPasswordResetToken,
  createVerificationToken,
} from "@resumerank/core/auth/tokens";
import { sendPasswordResetEmail, sendVerificationEmail } from "@resumerank/core/email";
import { AUTH_LIMIT, rateLimit } from "@resumerank/core/rate-limit";
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from "@resumerank/core/validators/auth";
import { runAction } from "@/server/run-action";
import { actionError, actionOk, type ActionResult } from "@resumerank/core/types/action";

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}

function tooManyAttempts(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

export async function registerAction(
  input: unknown,
): Promise<ActionResult<{ email: string }>> {
  return runAction(async () => {
    const parsed = registerSchema.safeParse(input);
    if (!parsed.success) {
      return actionError(
        "Check the highlighted fields.",
        parsed.error.flatten().fieldErrors,
      );
    }
    const { name, email, password } = parsed.data;

    const ip = await clientIp();
    const limited = rateLimit(`register:${ip}`, AUTH_LIMIT);
    if (!limited.allowed) {
      return actionError(tooManyAttempts(limited.retryAfterSeconds));
    }

    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
      return actionError("An account with this email already exists.", {
        email: ["An account with this email already exists."],
      });
    }

    const isFirstUser = (await db.user.count()) === 0;
    await db.user.create({
      data: {
        name,
        email,
        passwordHash: await hashPassword(password),
        role: isFirstUser ? "OWNER" : "MEMBER",
      },
    });

    const token = await createVerificationToken(email);
    await sendVerificationEmail(email, token);

    return actionOk({ email });
  });
}

export async function loginAction(
  input: unknown,
): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const parsed = loginSchema.safeParse(input);
    if (!parsed.success) {
      return actionError(
        "Check the highlighted fields.",
        parsed.error.flatten().fieldErrors,
      );
    }

    const ip = await clientIp();
    const limited = rateLimit(
      `login:${ip}:${parsed.data.email}`,
      AUTH_LIMIT,
    );
    if (!limited.allowed) {
      return actionError(tooManyAttempts(limited.retryAfterSeconds));
    }

    try {
      await signIn("credentials", {
        email: parsed.data.email,
        password: parsed.data.password,
        redirect: false,
      });
    } catch (error) {
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
  return runAction(async () => {
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
  return runAction(async () => {
    const parsed = forgotPasswordSchema.safeParse(input);
    if (!parsed.success) return actionError("Enter a valid email address.");
    const { email } = parsed.data;

    const ip = await clientIp();
    const limited = rateLimit(`verify:${ip}:${email}`, AUTH_LIMIT);
    if (!limited.allowed) {
      return actionError(tooManyAttempts(limited.retryAfterSeconds));
    }

    const user = await db.user.findUnique({ where: { email } });
    // Always report success so this endpoint can't be used to probe accounts.
    if (user && !user.emailVerified) {
      const token = await createVerificationToken(email);
      await sendVerificationEmail(email, token);
    }
    return actionOk(undefined);
  });
}

export async function forgotPasswordAction(
  input: unknown,
): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const parsed = forgotPasswordSchema.safeParse(input);
    if (!parsed.success) return actionError("Enter a valid email address.");
    const { email } = parsed.data;

    const ip = await clientIp();
    const limited = rateLimit(`reset:${ip}:${email}`, AUTH_LIMIT);
    if (!limited.allowed) {
      return actionError(tooManyAttempts(limited.retryAfterSeconds));
    }

    const user = await db.user.findUnique({ where: { email } });
    if (user) {
      const token = await createPasswordResetToken(user.id);
      await sendPasswordResetEmail(email, token);
    }
    return actionOk(undefined);
  });
}

export async function resetPasswordAction(
  input: unknown,
): Promise<ActionResult<undefined>> {
  return runAction(async () => {
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

    await db.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(parsed.data.password) },
    });
    return actionOk(undefined);
  });
}
