import type { ScoringJob } from "./engine";
import { resumeForScoring } from "./redact";

/** The company settings that decide whether and how a candidate is scored. */
export interface ScoringPolicy {
  aiRedactPii: boolean;
  aiNoticeRequired: boolean;
}

export interface ScoringCandidate {
  name: string;
  email: string;
  resumeText: string;
  aiNoticeAt: Date | null;
  aiOptOutAt: Date | null;
}

export const SCORING_POLICY_SELECT = { aiRedactPii: true, aiNoticeRequired: true } as const;

export const SCORING_CANDIDATE_SELECT = {
  name: true,
  email: true,
  resumeText: true,
  aiNoticeAt: true,
  aiOptOutAt: true,
} as const;

export const OPTED_OUT_MESSAGE =
  "This candidate opted out of AI scoring. Review their application without it.";
export const NOTICE_REQUIRED_MESSAGE =
  "Your workspace requires the AI notice before scoring. Record that this candidate was given it first.";

/** Why this candidate may not be scored, or null when they may. */
export function scoringRefusal(candidate: ScoringCandidate, policy: ScoringPolicy): string | null {
  if (candidate.aiOptOutAt) return OPTED_OUT_MESSAGE;
  if (policy.aiNoticeRequired && !candidate.aiNoticeAt) return NOTICE_REQUIRED_MESSAGE;
  return null;
}

/** The resume text the model sees: redacted when the company asks for it. */
export function scoringResume(candidate: ScoringCandidate, policy: ScoringPolicy): string {
  return resumeForScoring(candidate.resumeText, candidate, policy.aiRedactPii);
}

/** Stored on each run (ScoringRun.input) so the score can be explained and reproduced later. */
export interface ScoringInput {
  title: string;
  description: string;
  requirements: Array<{ id: string; label: string; weight: string }>;
  resume: string;
}

export function scoringInput(job: ScoringJob, resume: string): ScoringInput {
  return {
    title: job.title,
    description: job.description,
    requirements: job.requirements.map(({ id, label, weight }) => ({ id, label, weight })),
    resume,
  };
}
