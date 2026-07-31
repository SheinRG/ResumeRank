import { z } from "zod";
import { candidateSourceSchema, jobStatusSchema, stageSchema } from "./enums";

export const PAGE_SIZE = 25;

const pageSchema = z.coerce.number().int().min(1).max(10_000).catch(1);
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
  page: pageSchema.default(1),
});
export type JobListParams = z.infer<typeof jobListParamsSchema>;

export const candidateListParamsSchema = z.object({
  q: querySchema.default(""),
  source: candidateSourceSchema.optional().catch(undefined),
  sort: z.enum(["newest", "oldest", "name"]).catch("newest"),
  page: pageSchema.default(1),
});
export type CandidateListParams = z.infer<typeof candidateListParamsSchema>;

export const applicationListParamsSchema = z.object({
  q: querySchema.default(""),
  stage: stageSchema.optional().catch(undefined),
  sort: z.enum(["score", "newest", "oldest"]).catch("score"),
  page: pageSchema.default(1),
});
export type ApplicationListParams = z.infer<typeof applicationListParamsSchema>;
