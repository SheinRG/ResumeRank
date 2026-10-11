import { z } from "zod";

const idSchema = z.string().trim().min(1, "Missing id").max(64, "Invalid id");

export const totpCodeSchema = z
  .string()
  .transform((value) => value.replace(/\s/g, ""))
  .pipe(z.string().regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app"));

/**
 * Ignores case, spaces and dashes, which people add or drop when typing a code
 * back. Base32 has no 0 or 1, so those can only be a misread o or l.
 */
export function normalizeRecoveryCode(input: string): string {
  return input.toLowerCase().replace(/[\s-]/g, "").replace(/0/g, "o").replace(/1/g, "l");
}

export const recoveryCodeSchema = z
  .string()
  .transform(normalizeRecoveryCode)
  .pipe(z.string().regex(/^[a-z2-7]{16}$/, "Enter one of your recovery codes, like abcd-efgh-ijkl-mnop"));

export const confirmTotpSchema = z.object({ code: totpCodeSchema });
export type ConfirmTotpInput = z.infer<typeof confirmTotpSchema>;

export const mfaCodeChallengeSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("totp"), code: totpCodeSchema }),
  z.object({ method: z.literal("recovery"), code: recoveryCodeSchema }),
]);
export type MfaCodeChallengeInput = z.infer<typeof mfaCodeChallengeSchema>;

// The browser's WebAuthn responses, bounded so a client can't post megabytes;
// their contents are verified cryptographically by the WebAuthn library.
const base64UrlSchema = z.string().max(16_384).regex(/^[A-Za-z0-9_-]*$/, "Invalid encoding");

const transportSchema = z.enum(["ble", "cable", "hybrid", "internal", "nfc", "smart-card", "usb"]);

/** Extension outputs aren't used, and unknown keys are stripped. */
const clientExtensionResultsSchema = z.object({});

export const registrationResponseSchema = z.object({
  id: base64UrlSchema,
  rawId: base64UrlSchema,
  type: z.literal("public-key"),
  authenticatorAttachment: z.enum(["cross-platform", "platform"]).optional(),
  clientExtensionResults: clientExtensionResultsSchema,
  response: z.object({
    clientDataJSON: base64UrlSchema,
    attestationObject: base64UrlSchema,
    authenticatorData: base64UrlSchema.optional(),
    transports: z.array(transportSchema).max(8).optional(),
    publicKeyAlgorithm: z.number().int().optional(),
    publicKey: base64UrlSchema.optional(),
  }),
});

export const authenticationResponseSchema = z.object({
  id: base64UrlSchema,
  rawId: base64UrlSchema,
  type: z.literal("public-key"),
  authenticatorAttachment: z.enum(["cross-platform", "platform"]).optional(),
  clientExtensionResults: clientExtensionResultsSchema,
  response: z.object({
    clientDataJSON: base64UrlSchema,
    authenticatorData: base64UrlSchema,
    signature: base64UrlSchema,
    userHandle: base64UrlSchema.optional(),
  }),
});

export const passkeyNameSchema = z
  .string()
  .trim()
  .min(1, "Name this passkey so you can tell it apart later")
  .max(60, "Keep the name under 60 characters");

export const finishPasskeyRegistrationSchema = z.object({
  name: passkeyNameSchema,
  response: registrationResponseSchema,
});
export type FinishPasskeyRegistrationInput = z.infer<typeof finishPasskeyRegistrationSchema>;

export const passkeyChallengeSchema = z.object({ response: authenticationResponseSchema });
export type PasskeyChallengeInput = z.infer<typeof passkeyChallengeSchema>;

export const passkeyIdSchema = z.object({ passkeyId: idSchema });
export type PasskeyIdInput = z.infer<typeof passkeyIdSchema>;

export const setMfaRequiredSchema = z.object({ required: z.boolean() });
export type SetMfaRequiredInput = z.infer<typeof setMfaRequiredSchema>;

export const resetMemberMfaSchema = z.object({ userId: idSchema });
export type ResetMemberMfaInput = z.infer<typeof resetMemberMfaSchema>;
