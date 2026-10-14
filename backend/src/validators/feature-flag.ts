import { z } from "zod";

import { FEATURE_FLAGS } from "../flags/registry";

export const featureFlagSchema = z.enum(FEATURE_FLAGS, { error: "Unknown flag" });

/** A staff change from the flags CLI; `enabled: null` removes the override. */
export const flagOverrideSchema = z.object({
  companySlug: z.string().trim().min(1, "Name the company by its slug").max(64, "Invalid slug"),
  flag: featureFlagSchema,
  enabled: z.boolean().nullable(),
  reason: z.string().trim().max(500, "Keep the reason under 500 characters").optional(),
});
export type FlagOverrideInput = z.infer<typeof flagOverrideSchema>;
