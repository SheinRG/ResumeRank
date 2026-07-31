import { z } from "zod";
import { candidateSourceSchema } from "./enums";
import { emailSchema } from "./auth";
import { optionalText } from "./helpers";

export const MIN_RESUME_LENGTH = 200;

export const candidateCreateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters")
    .max(80, "Name must be at most 80 characters"),
  email: emailSchema,
  headline: optionalText(120, "Headline must be at most 120 characters"),
  source: candidateSourceSchema,
  resumeText: z
    .string()
    .trim()
    .min(
      MIN_RESUME_LENGTH,
      `Resume text must be at least ${MIN_RESUME_LENGTH} characters so scoring has something to work with`,
    )
    .max(50_000, "Resume text must be at most 50,000 characters"),
});
export type CandidateCreateInput = z.infer<typeof candidateCreateSchema>;

export const candidateUpdateSchema = candidateCreateSchema.extend({
  id: z.string().min(1),
});
export type CandidateUpdateInput = z.infer<typeof candidateUpdateSchema>;
