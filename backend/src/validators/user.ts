import { z } from "zod";

import { passwordSchema } from "./auth";

// A profile avatar is stored as an https URL (or cleared with an empty string,
// which the action normalises to null). Kept optional so name-only saves work.
const avatarUrlSchema = z
  .string()
  .trim()
  .max(2048, "URL is too long")
  .url("Enter a valid image URL")
  .refine((value) => /^https:\/\//i.test(value), "Image URL must start with https://");

export const updateProfileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters")
    .max(80, "Name must be at most 80 characters"),
  image: z.union([avatarUrlSchema, z.literal("")]).optional(),
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
