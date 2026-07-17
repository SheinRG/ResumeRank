import { z } from "zod";

import { passwordSchema } from "./auth";

// A profile avatar is either an uploaded picture — downscaled to a square by
// the client and inlined as a base64 data URL, so there is no blob store to
// operate — or an https URL from an OAuth provider. An empty string clears it
// (the action normalises that to null); optional so name-only saves work.
const AVATAR_MAX_LENGTH = 150_000;
const AVATAR_DATA_URL = /^data:image\/(?:webp|jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/;

const avatarSchema = z
  .string()
  .trim()
  .max(AVATAR_MAX_LENGTH, "That image is too large — choose a smaller one")
  .refine(
    (value) =>
      value === "" ||
      AVATAR_DATA_URL.test(value) ||
      (/^https:\/\//i.test(value) && value.length <= 2048 && URL.canParse(value)),
    "Choose an image file, or paste an https link to one",
  );

export const updateProfileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters")
    .max(80, "Name must be at most 80 characters"),
  image: avatarSchema.optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password"),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const notificationPreferencesSchema = z.object({
  notifyByEmail: z.boolean(),
});
export type NotificationPreferencesInput = z.infer<
  typeof notificationPreferencesSchema
>;

export const deleteAccountSchema = z.object({
  confirmEmail: z.string().trim().min(1, "Type your email to confirm"),
  password: z.string().optional(),
});
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
