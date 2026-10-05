import { z } from "zod";
import { candidateSourceSchema, jobStatusSchema, stageSchema } from "./enums";

export const PAGE_SIZE = 25;

/** Opaque keyset cursor (base64url); anything else is dropped and the list starts over. */
export const cursorParamSchema = z
  .string()
  .max(512)
  .regex(/^[A-Za-z0-9_-]+$/)
  .optional()
  .catch(undefined);
const querySchema = z
  .string()
  .trim()
  .max(200)
  .catch("")
  .transform((v) => v.slice(0, 200));

export const jobListParamsSchema = z.object({
  q: querySchema.default(""),
  status: jobStatusSchema.optional().catch(undefined),
  sort: z.enum(["newest", "oldest", "title"]).catch("newest"),
  after: cursorParamSchema,
  before: cursorParamSchema,
});
export type JobListParams = z.infer<typeof jobListParamsSchema>;

export const candidateListParamsSchema = z.object({
  q: querySchema.default(""),
  source: candidateSourceSchema.optional().catch(undefined),
  sort: z.enum(["newest", "oldest", "name"]).catch("newest"),
  after: cursorParamSchema,
  before: cursorParamSchema,
});
export type CandidateListParams = z.infer<typeof candidateListParamsSchema>;

export const applicationListParamsSchema = z.object({
  q: querySchema.default(""),
  stage: stageSchema.optional().catch(undefined),
  sort: z.enum(["score", "newest", "oldest"]).catch("score"),
  after: cursorParamSchema,
  before: cursorParamSchema,
});
export type ApplicationListParams = z.infer<typeof applicationListParamsSchema>;

/** Matches the attach-candidate picker returns per keystroke. */
export const CANDIDATE_OPTION_LIMIT = 20;

export const candidateOptionParamsSchema = z.object({
  q: querySchema.default(""),
});
export type CandidateOptionParams = z.infer<typeof candidateOptionParamsSchema>;
