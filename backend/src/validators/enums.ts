import { z } from "zod";

export const ROLES = ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

export const JOB_STATUSES = ["DRAFT", "OPEN", "CLOSED", "ARCHIVED"] as const;
export const jobStatusSchema = z.enum(JOB_STATUSES);
export type JobStatus = z.infer<typeof jobStatusSchema>;

export const EMPLOYMENT_TYPES = [
  "FULL_TIME",
  "PART_TIME",
  "CONTRACT",
  "INTERNSHIP",
] as const;
export const employmentTypeSchema = z.enum(EMPLOYMENT_TYPES);
export type EmploymentType = z.infer<typeof employmentTypeSchema>;

export const REQUIREMENT_WEIGHTS = ["MUST", "NICE"] as const;
export const requirementWeightSchema = z.enum(REQUIREMENT_WEIGHTS);
export type RequirementWeight = z.infer<typeof requirementWeightSchema>;

export const CANDIDATE_SOURCES = [
  "MANUAL",
  "REFERRAL",
  "JOB_BOARD",
  "OUTREACH",
  "OTHER",
] as const;
export const candidateSourceSchema = z.enum(CANDIDATE_SOURCES);
export type CandidateSource = z.infer<typeof candidateSourceSchema>;

export const STAGES = [
  "NEW",
  "SCREENING",
  "SHORTLISTED",
  "INTERVIEW",
  "OFFER",
  "HIRED",
  "REJECTED",
] as const;
export const stageSchema = z.enum(STAGES);
export type Stage = z.infer<typeof stageSchema>;

export const VERDICTS = ["STRONG", "PARTIAL", "MISSING"] as const;
export const verdictSchema = z.enum(VERDICTS);
export type Verdict = z.infer<typeof verdictSchema>;
