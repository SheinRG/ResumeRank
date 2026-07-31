import { z } from "zod";
import { verdictSchema } from "./enums";

/**
 * The JSON contract the LLM must return. Anything that fails this schema is
 * rejected wholesale — no partial evaluation rows are ever persisted.
 */
export const llmEvaluationSchema = z.object({
  requirementId: z.string().min(1),
  verdict: verdictSchema,
  evidence: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .transform((v) => (v === "" ? null : v)),
  note: z.string().trim().min(1).max(500),
});
export type LlmEvaluation = z.infer<typeof llmEvaluationSchema>;

export const llmScoringResultSchema = z.object({
  summary: z.string().trim().min(1).max(1_000),
  evaluations: z.array(llmEvaluationSchema).min(1),
});
export type LlmScoringResult = z.infer<typeof llmScoringResultSchema>;
