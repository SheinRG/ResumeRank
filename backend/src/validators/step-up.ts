import { z } from "zod";

import { MAX_PASSWORD_LENGTH } from "./auth";
import { authenticationResponseSchema, totpCodeSchema } from "./mfa";

/** Recovery codes aren't offered: a routine confirmation shouldn't use up a last-resort code. */
export const reauthSchema = z.discriminatedUnion("method", [
  z.object({
    method: z.literal("password"),
    password: z.string().min(1, "Enter your password").max(MAX_PASSWORD_LENGTH, "That password is too long"),
  }),
  z.object({ method: z.literal("totp"), code: totpCodeSchema }),
  z.object({ method: z.literal("passkey"), response: authenticationResponseSchema }),
]);
export type ReauthInput = z.infer<typeof reauthSchema>;
