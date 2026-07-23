import { z } from "zod";

import { emailSchema, passwordSchema } from "./auth";
import { optionalText } from "./helpers";
import { roleSchema } from "./enums";

export const companyNameSchema = z
  .string()
  .trim()
  .min(2, "Company name must be at least 2 characters")
  .max(80, "Company name must be at most 80 characters");

export const registerCompanySchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters")
    .max(80, "Name must be at most 80 characters"),
  email: emailSchema,
  password: passwordSchema,
  companyName: companyNameSchema,
});
export type RegisterCompanyInput = z.infer<typeof registerCompanySchema>;

// A logo/website link is either empty (cleared) or a well-formed https URL —
// same shape as the avatar field in user.ts, just without the data-URL case.
const urlOrEmptySchema = z
  .string()
  .trim()
  .max(2048, "That link is too long")
  .refine(
    (value) => value === "" || (/^https:\/\//i.test(value) && URL.canParse(value)),
    "Enter a valid https link",
  );

export const updateCompanySchema = z.object({
  name: companyNameSchema,
  logoUrl: urlOrEmptySchema.optional(),
  website: urlOrEmptySchema.optional(),
  description: optionalText(500, "Description must be at most 500 characters"),
  industry: optionalText(80, "Industry must be at most 80 characters"),
  size: optionalText(40, "Size must be at most 40 characters"),
  location: optionalText(120, "Location must be at most 120 characters"),
});
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;

export const inviteRoleSchema = roleSchema.exclude(["OWNER"] as const);

export const inviteMemberSchema = z.object({
  email: emailSchema,
  role: inviteRoleSchema,
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const acceptInviteSchema = z.object({
  token: z.string().min(1, "Invite token is missing"),
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters")
    .max(80, "Name must be at most 80 characters"),
  password: passwordSchema,
});
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
