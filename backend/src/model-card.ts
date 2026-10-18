import baseline from "../evals/scoring/baseline.json";
import { env } from "./env";
import { SCORING_PROMPT_VERSION, SCORING_SEED, SCORING_TEMPERATURE } from "./scoring/engine";

/**
 * The facts the public model card states, read from the running
 * configuration and the committed eval baseline rather than typed into the
 * page, so the card can't claim numbers the scoring gate didn't measure.
 */
export interface ModelCardFacts {
  model: string;
  fallbackModel: string | null;
  promptVersion: string;
  temperature: number;
  seed: number;
  evaluation: {
    datasetVersion: number;
    model: string;
    promptVersion: string;
    judgments: number;
    verdictAccuracy: number;
    verdictKappa: number;
    evidencePrecision: number;
    scoreMae: number;
    injectionRecall: number;
    stability: number;
  };
}

export function modelCardFacts(): ModelCardFacts {
  const { GROQ_MODEL, GROQ_FALLBACK_MODEL } = env();
  const { metrics } = baseline;
  return {
    model: GROQ_MODEL,
    fallbackModel: GROQ_FALLBACK_MODEL ?? null,
    promptVersion: SCORING_PROMPT_VERSION,
    temperature: SCORING_TEMPERATURE,
    seed: SCORING_SEED,
    evaluation: {
      datasetVersion: baseline.datasetVersion,
      model: baseline.model,
      promptVersion: baseline.promptVersion,
      judgments: metrics.judgments,
      verdictAccuracy: metrics.verdictAccuracy,
      verdictKappa: metrics.verdictKappa,
      evidencePrecision: metrics.evidencePrecision,
      scoreMae: metrics.scoreMae,
      injectionRecall: metrics.injectionRecall,
      stability: metrics.stability,
    },
  };
}
