import type { RequirementWeight, Verdict } from "@/lib/validators/enums";

const WEIGHT_FACTOR: Record<RequirementWeight, number> = {
  MUST: 2,
  NICE: 1,
};

const VERDICT_CREDIT: Record<Verdict, number> = {
  STRONG: 1,
  PARTIAL: 0.5,
  MISSING: 0,
};

export interface ScorableEvaluation {
  weight: RequirementWeight;
  verdict: Verdict;
}

/**
 * Weighted match percentage, 0–100. Must-haves count double so a missing
 * must-have hurts twice as much as a missing nice-to-have.
 */
export function computeScore(evaluations: ScorableEvaluation[]): number {
  if (evaluations.length === 0) return 0;
  let earned = 0;
  let possible = 0;
  for (const e of evaluations) {
    const factor = WEIGHT_FACTOR[e.weight];
    possible += factor;
    earned += factor * VERDICT_CREDIT[e.verdict];
  }
  return Math.round((earned / possible) * 100);
}

export function scoreTone(score: number): "strong" | "medium" | "weak" {
  if (score >= 75) return "strong";
  if (score >= 50) return "medium";
  return "weak";
}
