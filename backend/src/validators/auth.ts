import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Email is required")
  .max(254, "Email is too long")
  .email("Enter a valid email address");

/** The floor every password meets, whatever a workspace's policy; policies can only raise it. */
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

/**
 * A new password under a policy's minimum length. Forms build it from the
 * policy they were given; the server checks again against the policy it
 * resolves itself (auth/password-policy.ts), along with the breach check.
 */
export function passwordSchemaFor(minLength: number) {
  return z
    .string()
    .min(minLength, `Password must be at least ${minLength} characters`)
    .max(MAX_PASSWORD_LENGTH, `Password must be at most ${MAX_PASSWORD_LENGTH} characters`);
}

export const passwordSchema = passwordSchemaFor(MIN_PASSWORD_LENGTH);

export const registerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters")
    .max(80, "Name must be at most 80 characters"),
  email: emailSchema,
  password: passwordSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export function resetPasswordSchemaFor(minLength: number) {
  return z.object({
    token: z.string().min(1, "Reset token is missing"),
    password: passwordSchemaFor(minLength),
  });
}
export const resetPasswordSchema = resetPasswordSchemaFor(MIN_PASSWORD_LENGTH);
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
