import { z } from "zod";

import { MIN_PASSWORD_LENGTH } from "./auth";

/** Long enough for a passphrase policy, short enough that a password manager's default still fits. */
export const MAX_POLICY_MIN_LENGTH = 64;

export const passwordPolicySchema = z.object({
  minLength: z
    .number()
    .int()
    .min(MIN_PASSWORD_LENGTH, `Passwords can't be required to be shorter than ${MIN_PASSWORD_LENGTH} characters`)
    .max(MAX_POLICY_MIN_LENGTH, `Require at most ${MAX_POLICY_MIN_LENGTH} characters`),
  breachCheck: z.boolean(),
});
export type PasswordPolicyInput = z.infer<typeof passwordPolicySchema>;
