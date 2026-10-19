import { z } from "zod";

/** How long owners can let support in for at a time; 0 withdraws access. */
export const SUPPORT_ACCESS_DAYS = [0, 1, 3, 7, 14, 30] as const;

export const supportAccessSchema = z.object({
  days: z.literal(SUPPORT_ACCESS_DAYS, { error: "Choose how long support may have access" }),
});
export type SupportAccessInput = z.infer<typeof supportAccessSchema>;
