import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { canonicalForMatch } from "../../src/scoring/parse";
import { requirementWeightSchema, verdictSchema } from "../../src/validators/enums";

const labelSchema = z.object({
  verdict: verdictSchema,
  /** Passages of the resume that justify the label; a quote overlapping one is relevant. */
  evidence: z.array(z.string().min(1)).optional(),
});

const caseSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  tags: z.array(z.string()),
  /** The resume is written to steer the model; detection should flag it. */
  expectInjection: z.boolean().optional(),
  job: z.object({
    title: z.string().min(1),
    description: z.string().min(1),
    requirements: z
      .array(z.object({ id: z.string().min(1), label: z.string().min(1), weight: requirementWeightSchema }))
      .min(1),
  }),
  resume: z.string().min(1),
  labels: z.record(z.string(), labelSchema),
});

export const goldenSetSchema = z.object({
  version: z.number().int().positive(),
  description: z.string(),
  cases: z.array(caseSchema).min(1),
});

export type GoldenSet = z.infer<typeof goldenSetSchema>;
export type GoldenCase = z.infer<typeof caseSchema>;

export const GOLDEN_SET_PATH = fileURLToPath(new URL("./golden.json", import.meta.url));

/**
 * Mistakes in the labels themselves, which would otherwise surface as a
 * mysterious drop in agreement: every requirement labelled exactly once,
 * supporting labels backed by spans, and every span really in the resume.
 */
export function datasetProblems(set: GoldenSet): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const golden of set.cases) {
    if (seen.has(golden.id)) problems.push(`${golden.id}: duplicate case id`);
    seen.add(golden.id);

    const requirementIds = golden.job.requirements.map((r) => r.id);
    if (new Set(requirementIds).size !== requirementIds.length) {
      problems.push(`${golden.id}: duplicate requirement id`);
    }
    const labelled = Object.keys(golden.labels);
    for (const id of requirementIds) {
      if (!labelled.includes(id)) problems.push(`${golden.id}/${id}: requirement has no label`);
    }
    for (const id of labelled) {
      if (!requirementIds.includes(id)) problems.push(`${golden.id}/${id}: label for an unknown requirement`);
    }

    const resume = canonicalForMatch(golden.resume);
    for (const [id, label] of Object.entries(golden.labels)) {
      const spans = label.evidence ?? [];
      if (label.verdict !== "MISSING" && spans.length === 0) {
        problems.push(`${golden.id}/${id}: ${label.verdict} needs at least one evidence span`);
      }
      if (label.verdict === "MISSING" && spans.length > 0) {
        problems.push(`${golden.id}/${id}: MISSING should not carry evidence`);
      }
      for (const span of spans) {
        if (!resume.includes(canonicalForMatch(span))) {
          problems.push(`${golden.id}/${id}: evidence span not found in resume: "${span}"`);
        }
      }
    }
  }
  return problems;
}

export function loadGoldenSet(path = GOLDEN_SET_PATH): GoldenSet {
  const set = goldenSetSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  const problems = datasetProblems(set);
  if (problems.length > 0) {
    throw new Error(`Golden set has ${problems.length} problem(s):\n- ${problems.join("\n- ")}`);
  }
  return set;
}
