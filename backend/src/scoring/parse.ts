import { DomainError } from "../services/errors";
import type { LlmScoringResult } from "../validators/scoring";
import type { EvidenceStatus, RequirementWeight, Verdict } from "../validators/enums";

export class ScoringError extends DomainError {}

export interface ScoringRequirement {
  id: string;
  label: string;
  weight: RequirementWeight;
}

export interface ReconciledEvaluation {
  requirementId: string;
  /** After the evidence rule; this is what the score counts. */
  verdict: Verdict;
  modelVerdict: Verdict;
  /** As the model cited it; only shown to recruiters when VERIFIED. */
  evidence: string | null;
  evidenceStatus: EvidenceStatus;
  note: string;
}

export interface ReconciledResult {
  summary: string;
  evaluations: ReconciledEvaluation[];
}

/**
 * The form quotes are matched in: NFKC folds ligatures and full-width forms,
 * then only letters and digits survive, so line breaks, hyphenation across a
 * break, bullets, and curly-vs-straight punctuation from PDF extraction can't
 * fail a quote that is really there. Words still have to appear in order.
 */
export function canonicalForMatch(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
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
 * exactly one evaluation per known requirement id. Every quote is checked
 * against the resume, and STRONG — "the resume explicitly demonstrates it" —
 * is only kept when a quote proves it; otherwise it counts as PARTIAL, so a
 * fabricated or missing citation can't carry full weight in the score.
 */
export function reconcileResult(
  result: LlmScoringResult,
  requirements: ScoringRequirement[],
  resumeText: string,
): ReconciledResult {
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

  const resume = canonicalForMatch(resumeText);
  const evaluations = requirements.map((r): ReconciledEvaluation => {
    const evaluation = byId.get(r.id);
    if (!evaluation) {
      throw new ScoringError("Model skipped a requirement.");
    }
    const quote = evaluation.evidence === null ? "" : canonicalForMatch(evaluation.evidence);
    const evidenceStatus: EvidenceStatus =
      evaluation.evidence === null || quote === ""
        ? "NONE"
        : resume.includes(quote)
          ? "VERIFIED"
          : "UNVERIFIED";
    const verdict =
      evaluation.verdict === "STRONG" && evidenceStatus !== "VERIFIED" ? "PARTIAL" : evaluation.verdict;
    return {
      requirementId: r.id,
      verdict,
      modelVerdict: evaluation.verdict,
      evidence: evidenceStatus === "NONE" ? null : evaluation.evidence,
      evidenceStatus,
      note: evaluation.note,
    };
  });

  return { summary: result.summary, evaluations };
}
