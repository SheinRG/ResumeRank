import { z } from "zod";
import {
  employmentTypeSchema,
  jobStatusSchema,
  requirementWeightSchema,
} from "./enums";

export const jobRequirementInputSchema = z.object({
  id: z.string().optional(),
  label: z
    .string()
    .trim()
    .min(3, "Requirement must be at least 3 characters")
    .max(200, "Requirement must be at most 200 characters"),
  weight: requirementWeightSchema,
});
export type JobRequirementInput = z.infer<typeof jobRequirementInputSchema>;

export const jobCreateSchema = z.object({
  title: z
    .string()
    .trim()
    .min(3, "Title must be at least 3 characters")
    .max(120, "Title must be at most 120 characters"),
  description: z
    .string()
    .trim()
    .min(30, "Description must be at least 30 characters")
    .max(10_000, "Description must be at most 10,000 characters"),
  location: z
    .string()
    .trim()
    .max(120, "Location must be at most 120 characters")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  employmentType: employmentTypeSchema,
  status: jobStatusSchema,
  requirements: z
    .array(jobRequirementInputSchema)
    .min(1, "Add at least one requirement — scoring needs a rubric")
    .max(20, "Keep it to 20 requirements or fewer"),
});
export type JobCreateInput = z.infer<typeof jobCreateSchema>;

export const jobUpdateSchema = jobCreateSchema.extend({
  id: z.string().min(1),
});
export type JobUpdateInput = z.infer<typeof jobUpdateSchema>;
