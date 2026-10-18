import { z } from "zod";

export const MAX_NOTICE_LENGTH = 4000;

export const aiPolicySchema = z.object({
  aiRedactPii: z.boolean(),
  aiNoticeRequired: z.boolean(),
  /** Blank restores the default notice. */
  aiNoticeText: z
    .string()
    .trim()
    .max(MAX_NOTICE_LENGTH, `Keep the notice under ${MAX_NOTICE_LENGTH} characters`)
    .transform((text) => (text.length === 0 ? null : text)),
});
export type AiPolicyInput = z.infer<typeof aiPolicySchema>;

export const candidateAiFlagsSchema = z.object({
  id: z.string().min(1),
  /** The candidate was given the AI notice. */
  noticeGiven: z.boolean(),
  /** The candidate asked not to be scored by AI. */
  optedOut: z.boolean(),
});
export type CandidateAiFlagsInput = z.infer<typeof candidateAiFlagsSchema>;

export const SELF_ID_SEXES = ["FEMALE", "MALE"] as const;
export const SELF_ID_RACES = [
  "HISPANIC_OR_LATINO",
  "WHITE",
  "BLACK_OR_AFRICAN_AMERICAN",
  "NATIVE_HAWAIIAN_OR_PACIFIC_ISLANDER",
  "ASIAN",
  "AMERICAN_INDIAN_OR_ALASKA_NATIVE",
  "TWO_OR_MORE_RACES",
] as const;
export type SelfIdSex = (typeof SELF_ID_SEXES)[number];
export type SelfIdRace = (typeof SELF_ID_RACES)[number];

/** "DECLINED" is "prefer not to say", stored as null. */
export const selfIdSchema = z.object({
  token: z.string().min(1).max(200),
  sex: z.enum([...SELF_ID_SEXES, "DECLINED"]),
  race: z.enum([...SELF_ID_RACES, "DECLINED"]),
});
export type SelfIdInput = z.infer<typeof selfIdSchema>;

export const impactReportSchema = z.object({
  jobId: z.string().min(1).optional(),
});
export type ImpactReportInput = z.infer<typeof impactReportSchema>;

/** Counted from the candidate's last change, or the last change to any of their applications. */
export const CANDIDATE_RETENTION_DAYS = [180, 365, 730, 1095] as const;

export const candidateRetentionSchema = z.object({
  retentionDays: z.literal(CANDIDATE_RETENTION_DAYS, { error: "Choose one of the listed periods" }).nullable(),
});
export type CandidateRetentionInput = z.infer<typeof candidateRetentionSchema>;

export const deleteWorkspaceSchema = z.object({
  confirmName: z.string().trim().min(1, "Type the workspace name to confirm"),
});
export type DeleteWorkspaceInput = z.infer<typeof deleteWorkspaceSchema>;
