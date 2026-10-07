import { describe, expect, it } from "vitest";
import {
  extractJson,
  reconcileResult,
  ScoringError,
  type ScoringRequirement,
} from "../../src/scoring/parse";
import type { LlmScoringResult } from "../../src/validators/scoring";

const requirements: ScoringRequirement[] = [
  { id: "r1", label: "5+ years React", weight: "MUST" },
  { id: "r2", label: "TypeScript strict", weight: "MUST" },
];

const resume =
  "Seven years of production React experience.\nShipped TypeScript strict codebases.";

function result(
  evaluations: LlmScoringResult["evaluations"],
): LlmScoringResult {
  return { summary: "Strong candidate overall.", evaluations };
}

describe("extractJson", () => {
  it("parses a clean JSON object", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("recovers JSON wrapped in prose or fences", () => {
    expect(extractJson('Here you go:\n```json\n{"a":1}\n```')).toEqual({
      a: 1,
    });
  });

  it("throws a ScoringError when no object is present", () => {
    expect(() => extractJson("no json here")).toThrow(ScoringError);
  });

  it("throws a ScoringError on malformed JSON", () => {
    expect(() => extractJson('{"a":')).toThrow(ScoringError);
  });
});

describe("reconcileResult", () => {
  it("keeps evidence that appears verbatim in the resume", () => {
    const out = reconcileResult(
      result([
        {
          requirementId: "r1",
          verdict: "STRONG",
          evidence: "Seven years of production React experience.",
          note: "Well past the bar.",
        },
        { requirementId: "r2", verdict: "STRONG", evidence: null, note: "Yes." },
      ]),
      requirements,
      resume,
    );
    expect(out.evaluations[0].evidence).toBe(
      "Seven years of production React experience.",
    );
  });

  it("matches evidence across whitespace and case differences", () => {
    const out = reconcileResult(
      result([
        {
          requirementId: "r1",
          verdict: "STRONG",
          evidence: "seven years of\nproduction react experience.",
          note: "n",
        },
        { requirementId: "r2", verdict: "STRONG", evidence: null, note: "n" },
      ]),
      requirements,
      resume,
    );
    expect(out.evaluations[0].evidenceStatus).toBe("VERIFIED");
  });

  it("matches quotes through PDF artifacts: ligatures, curly quotes, hyphenated line breaks", () => {
    const pdfResume = "Led the “Atlas” platform — a ﬁve-person team.\nShipped data-engi-\nneering pipelines.";
    const out = reconcileResult(
      result([
        {
          requirementId: "r1",
          verdict: "STRONG",
          evidence: 'Led the "Atlas" platform - a five-person team.',
          note: "n",
        },
        { requirementId: "r2", verdict: "PARTIAL", evidence: "Shipped data-engineering pipelines.", note: "n" },
      ]),
      requirements,
      pdfResume,
    );
    expect(out.evaluations.map((e) => e.evidenceStatus)).toEqual(["VERIFIED", "VERIFIED"]);
  });

  it("caps STRONG at PARTIAL when no quote backs it, keeping what the model said", () => {
    const out = reconcileResult(
      result([
        { requirementId: "r1", verdict: "STRONG", evidence: null, note: "n" },
        { requirementId: "r2", verdict: "PARTIAL", evidence: null, note: "n" },
      ]),
      requirements,
      resume,
    );
    expect(out.evaluations[0]).toMatchObject({ verdict: "PARTIAL", modelVerdict: "STRONG", evidenceStatus: "NONE" });
    expect(out.evaluations[1]).toMatchObject({ verdict: "PARTIAL", modelVerdict: "PARTIAL" });
  });

  it("treats a quote with no letters or digits as no quote", () => {
    const out = reconcileResult(
      result([
        { requirementId: "r1", verdict: "MISSING", evidence: "—", note: "n" },
        { requirementId: "r2", verdict: "MISSING", evidence: null, note: "n" },
      ]),
      requirements,
      resume,
    );
    expect(out.evaluations[0]).toMatchObject({ evidence: null, evidenceStatus: "NONE", verdict: "MISSING" });
  });

  it("flags fabricated quotes and caps their verdict", () => {
    const out = reconcileResult(
      result([
        {
          requirementId: "r1",
          verdict: "STRONG",
          evidence: "Ten years leading React teams at Google.",
          note: "n",
        },
        { requirementId: "r2", verdict: "STRONG", evidence: null, note: "n" },
      ]),
      requirements,
      resume,
    );
    expect(out.evaluations[0]).toMatchObject({
      evidenceStatus: "UNVERIFIED",
      verdict: "PARTIAL",
      modelVerdict: "STRONG",
    });
  });

  it("orders evaluations by the requirement list, not model order", () => {
    const out = reconcileResult(
      result([
        { requirementId: "r2", verdict: "MISSING", evidence: null, note: "n" },
        { requirementId: "r1", verdict: "STRONG", evidence: null, note: "n" },
      ]),
      requirements,
      resume,
    );
    expect(out.evaluations.map((e) => e.requirementId)).toEqual(["r1", "r2"]);
  });

  it("rejects a skipped requirement", () => {
    expect(() =>
      reconcileResult(
        result([
          { requirementId: "r1", verdict: "STRONG", evidence: null, note: "n" },
        ]),
        requirements,
        resume,
      ),
    ).toThrow(ScoringError);
  });

  it("rejects unknown requirement ids", () => {
    expect(() =>
      reconcileResult(
        result([
          { requirementId: "r1", verdict: "STRONG", evidence: null, note: "n" },
          { requirementId: "bogus", verdict: "STRONG", evidence: null, note: "n" },
        ]),
        requirements,
        resume,
      ),
    ).toThrow(ScoringError);
  });

  it("rejects duplicate requirement ids", () => {
    expect(() =>
      reconcileResult(
        result([
          { requirementId: "r1", verdict: "STRONG", evidence: null, note: "n" },
          { requirementId: "r1", verdict: "PARTIAL", evidence: null, note: "n" },
        ]),
        requirements,
        resume,
      ),
    ).toThrow(ScoringError);
  });
});
