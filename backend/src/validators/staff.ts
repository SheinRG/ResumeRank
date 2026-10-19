import { z } from "zod";

import { featureFlagSchema } from "./feature-flag";

const idSchema = z.string().trim().min(1, "Missing id").max(64, "Invalid id");

/** Staff changes say why, so the audit trail answers the question someone will ask later. */
const reasonSchema = z
  .string()
  .trim()
  .min(10, "Say why in at least 10 characters, with a ticket reference if there is one")
  .max(500, "Keep the reason under 500 characters");

export const staffSearchSchema = z.object({
  q: z.string().trim().max(200, "Search for at most 200 characters").default(""),
});
export type StaffSearchInput = z.infer<typeof staffSearchSchema>;

export const staffCompanySchema = z.object({ companyId: idSchema });
export type StaffCompanyInput = z.infer<typeof staffCompanySchema>;

export const suspensionSchema = z.object({
  companyId: idSchema,
  suspended: z.boolean(),
  reason: reasonSchema,
});
export type SuspensionInput = z.infer<typeof suspensionSchema>;

export const MIN_AI_BUDGET = 0;
export const MAX_AI_BUDGET = 1_000_000_000;

export const aiBudgetOverrideSchema = z.object({
  companyId: idSchema,
  /** Null returns the workspace to its plan's budget, or the deployment default. */
  budget: z
    .number({ error: "Enter a number of tokens" })
    .int("Enter a whole number of tokens")
    .min(MIN_AI_BUDGET, "The budget can't be negative")
    .max(MAX_AI_BUDGET, "Enter at most 1,000,000,000 tokens")
    .nullable(),
  reason: reasonSchema,
});
export type AiBudgetOverrideInput = z.infer<typeof aiBudgetOverrideSchema>;

export const staffFlagOverrideSchema = z.object({
  companyId: idSchema,
  flag: featureFlagSchema,
  /** Null drops the override, so the plan, rollout and default apply again. */
  enabled: z.boolean().nullable(),
  reason: reasonSchema,
});
export type StaffFlagOverrideInput = z.infer<typeof staffFlagOverrideSchema>;

export const liftSuppressionSchema = z.object({
  companyId: idSchema,
  email: z.email("Enter a valid email").trim().toLowerCase(),
  reason: reasonSchema,
});
export type LiftSuppressionInput = z.infer<typeof liftSuppressionSchema>;

export const staffMemberActionSchema = z.object({
  companyId: idSchema,
  userId: idSchema,
  reason: reasonSchema,
});
export type StaffMemberActionInput = z.infer<typeof staffMemberActionSchema>;

/** Short on purpose: a support session is for looking at one problem, not for working in the account. */
export const SUPPORT_SESSION_MINUTES = [15, 30, 60] as const;

export const supportSessionStartSchema = z.object({
  companyId: idSchema,
  userId: idSchema,
  reason: reasonSchema,
  minutes: z.literal(SUPPORT_SESSION_MINUTES, { error: "Choose 15, 30 or 60 minutes" }),
});
export type SupportSessionStartInput = z.infer<typeof supportSessionStartSchema>;

export const staffAuditPageSchema = z.object({
  cursor: z.string().max(200).optional(),
  companyId: idSchema.optional(),
});
export type StaffAuditPageInput = z.infer<typeof staffAuditPageSchema>;
