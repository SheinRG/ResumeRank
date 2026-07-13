import type { LlmScoringResult } from "../validators/scoring";
import type { RequirementWeight } from "../validators/enums";

export class ScoringError extends Error {}

export interface ScoringRequirement {
  id: string;
  label: string;
  weight: RequirementWeight;
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").toLowerCase();
}

export function extractJson(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new ScoringError("Model response contained no JSON object.");
  }
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new ScoringError("Model response was not valid JSON.");
  }
}

/**
 * Validates the parsed LLM output against the actual requirement set:
 * exactly one evaluation per known requirement id, and any "quote" that does
 * not actually appear in the resume is stripped so the UI never shows a
 * fabricated citation.
 */
export function reconcileResult(
  result: LlmScoringResult,
  requirements: ScoringRequirement[],
  resumeText: string,
): LlmScoringResult {
  const byId = new Map(result.evaluations.map((e) => [e.requirementId, e]));
  if (byId.size !== result.evaluations.length) {
    throw new ScoringError("Model returned duplicate requirement ids.");
  }

  const known = new Set(requirements.map((r) => r.id));
  for (const id of byId.keys()) {
    if (!known.has(id)) {
      throw new ScoringError("Model returned an unknown requirement id.");
    }
  }

  const resume = normalize(resumeText);
  const evaluations = requirements.map((r) => {
    const evaluation = byId.get(r.id);
    if (!evaluation) {
      throw new ScoringError("Model skipped a requirement.");
    }
    const quoteIsReal =
      evaluation.evidence !== null &&
      resume.includes(normalize(evaluation.evidence));
    return { ...evaluation, evidence: quoteIsReal ? evaluation.evidence : null };
  });

  return { summary: result.summary, evaluations };
}
