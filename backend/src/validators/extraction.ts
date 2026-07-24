import { z } from "zod";

/**
 * The JSON contract the extraction model must return. Every field is nullable:
 * the model returns null for anything the resume does not clearly state, and
 * the intake form only fills fields that came back non-null.
 */
const nullableTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => (value === "" ? null : value));

export const candidateProfileSchema = z.object({
  name: nullableTrimmed(80),
  email: nullableTrimmed(200),
  headline: nullableTrimmed(120),
});
export type CandidateProfile = z.infer<typeof candidateProfileSchema>;
