import { z } from "zod";
import { stageSchema } from "./enums";

export const applicationCreateSchema = z.object({
  jobId: z.string().min(1, "Pick a job"),
  candidateId: z.string().min(1, "Pick a candidate"),
});
export type ApplicationCreateInput = z.infer<typeof applicationCreateSchema>;

export const applicationStageSchema = z.object({
  id: z.string().min(1),
  stage: stageSchema,
});
export type ApplicationStageInput = z.infer<typeof applicationStageSchema>;

export const scorecardSchema = z.object({
  applicationId: z.string().min(1),
  rating: z
    .number()
    .int("Rating must be a whole number")
    .min(1, "Rating is 1 to 5")
    .max(5, "Rating is 1 to 5"),
  notes: z
    .string()
    .trim()
    .max(2_000, "Notes must be at most 2,000 characters")
    .optional()
    .or(z.literal("").transform(() => undefined)),
});
export type ScorecardInput = z.infer<typeof scorecardSchema>;
