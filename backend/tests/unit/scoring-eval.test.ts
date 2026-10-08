import { describe, expect, it } from "vitest";

import { datasetProblems, loadGoldenSet, type GoldenSet } from "../../evals/scoring/dataset";
import {
  citesSpan,
  cohensKappa,
  computeMetrics,
  gate,
  verdictDrift,
  verdictsOf,
  type Baseline,
  type CaseRun,
  type JudgedRequirement,
} from "../../evals/scoring/metrics";
import { detectInjection } from "../../src/ai/untrusted";
import type { Verdict } from "../../src/validators/enums";

describe("the golden set", () => {
  const golden = loadGoldenSet();

  it("is internally consistent", () => {
    expect(datasetProblems(golden)).toEqual([]);
    expect(golden.cases.length).toBeGreaterThanOrEqual(12);
  });

  it("covers every verdict and some injection attempts", () => {
    const verdicts = new Set(golden.cases.flatMap((c) => Object.values(c.labels).map((l) => l.verdict)));
    expect([...verdicts].sort()).toEqual(["MISSING", "PARTIAL", "STRONG"]);
    expect(golden.cases.filter((c) => c.expectInjection).length).toBeGreaterThanOrEqual(3);
  });

  // The detector is deterministic, so its share of the gate is checked here without a model.
  it("has every injection case flagged and no ordinary resume flagged", () => {
    for (const golden_case of golden.cases) {
      expect(detectInjection(golden_case.resume).length > 0, golden_case.id).toBe(golden_case.expectInjection ?? false);
    }
  });

  it("reports label mistakes", () => {
    const broken: GoldenSet = {
      version: 1,
      description: "",
      cases: [
        {
          id: "broken",
          tags: [],
          job: {
            title: "t",
            description: "d",
            requirements: [
              { id: "a", label: "A", weight: "MUST" },
              { id: "b", label: "B", weight: "MUST" },
            ],
          },
          resume: "Wrote Go services.",
          labels: {
            a: { verdict: "STRONG", evidence: ["Wrote Rust services."] },
            c: { verdict: "PARTIAL" },
          },
        },
      ],
    };
    expect(datasetProblems(broken)).toEqual([
      "broken/b: requirement has no label",
      "broken/c: label for an unknown requirement",
      'broken/a: evidence span not found in resume: "Wrote Rust services."',
      "broken/c: PARTIAL needs at least one evidence span",
    ]);
  });
});

describe("cohensKappa", () => {
  it("is 1 for perfect agreement and 0 for agreement no better than chance", () => {
    const perfect: Array<[Verdict, Verdict]> = [
      ["STRONG", "STRONG"],
      ["PARTIAL", "PARTIAL"],
      ["MISSING", "MISSING"],
    ];
    expect(cohensKappa(perfect)).toBe(1);
    const chance: Array<[Verdict, Verdict]> = [
      ["STRONG", "STRONG"],
      ["STRONG", "MISSING"],
      ["MISSING", "STRONG"],
      ["MISSING", "MISSING"],
    ];
    expect(cohensKappa(chance)).toBe(0);
  });

  it("matches a worked example", () => {
    // 10 items: 7 agreements; label marginals S=5/M=5, model marginals S=4/M=6.
    const pairs: Array<[Verdict, Verdict]> = [
      ...Array.from({ length: 3 }, (): [Verdict, Verdict] => ["STRONG", "STRONG"]),
      ...Array.from({ length: 2 }, (): [Verdict, Verdict] => ["STRONG", "MISSING"]),
      ...Array.from({ length: 1 }, (): [Verdict, Verdict] => ["MISSING", "STRONG"]),
      ...Array.from({ length: 4 }, (): [Verdict, Verdict] => ["MISSING", "MISSING"]),
    ];
    // po = 0.7, pe = 0.5*0.4 + 0.5*0.6 = 0.5, kappa = 0.4
    expect(cohensKappa(pairs)).toBeCloseTo(0.4, 10);
  });
});

function judged(overrides: Partial<JudgedRequirement> & Pick<JudgedRequirement, "expected" | "actual">): JudgedRequirement {
  return {
    requirementId: "r1",
    modelVerdict: overrides.actual,
    evidence: null,
    evidenceStatus: "NONE",
    spans: [],
    ...overrides,
  };
}

function caseRun(overrides: Partial<CaseRun> & Pick<CaseRun, "judgments">): CaseRun {
  return {
    caseId: "c1",
    model: "m",
    expectInjection: false,
    injectionSignals: [],
    expectedScore: 100,
    actualScore: 100,
    ...overrides,
  };
}

describe("computeMetrics", () => {
  it("scores evidence precision, relevance and recall separately", () => {
    const run = caseRun({
      judgments: [
        judged({
          requirementId: "r1",
          expected: "STRONG",
          actual: "STRONG",
          evidence: "Seven years of TypeScript",
          evidenceStatus: "VERIFIED",
          spans: ["Wrote production TypeScript for seven years. Seven years of TypeScript services"],
        }),
        judged({
          requirementId: "r2",
          expected: "STRONG",
          actual: "PARTIAL",
          evidence: "Maintained CI pipelines",
          evidenceStatus: "VERIFIED",
          spans: ["Designed the Postgres schema"],
        }),
        judged({ requirementId: "r3", expected: "MISSING", actual: "MISSING", evidence: "Invented", evidenceStatus: "UNVERIFIED" }),
      ],
      expectedScore: 100,
      actualScore: 75,
    });
    const metrics = computeMetrics([[run]]);
    expect(metrics.evidencePrecision).toBeCloseTo(2 / 3);
    expect(metrics.evidenceRelevance).toBe(0.5);
    expect(metrics.strongEvidenceRecall).toBe(0.5);
    expect(metrics.verdictAccuracy).toBeCloseTo(2 / 3);
    expect(metrics.confusion.STRONG.PARTIAL).toBe(1);
    expect(metrics.scoreMae).toBe(25);
    expect(metrics.stability).toBeNull();
  });

  it("measures injection recall, false positives and stability across repeats", () => {
    const attack = (signals: string[], actual: Verdict) =>
      caseRun({
        caseId: "attack",
        expectInjection: true,
        injectionSignals: signals,
        judgments: [judged({ expected: "MISSING", actual })],
      });
    const clean = caseRun({ caseId: "clean", injectionSignals: ["delimiter"], judgments: [judged({ expected: "STRONG", actual: "STRONG" })] });

    const metrics = computeMetrics([
      [attack(["ignore-instructions"], "MISSING"), clean],
      [attack([], "PARTIAL"), clean],
    ]);
    expect(metrics.injectionRecall).toBe(0.5);
    expect(metrics.injectionFalsePositives).toBe(2);
    expect(metrics.stability).toBe(0.5);
  });
});

describe("gate and drift", () => {
  const good = computeMetrics([
    [
      caseRun({
        judgments: [
          judged({ requirementId: "r1", expected: "STRONG", actual: "STRONG" }),
          judged({ requirementId: "r2", expected: "MISSING", actual: "MISSING" }),
          judged({ requirementId: "r3", expected: "PARTIAL", actual: "PARTIAL" }),
        ],
      }),
    ],
  ]);
  const baseline: Baseline = {
    datasetVersion: 1,
    model: "m",
    promptVersion: "p",
    metrics: good,
    verdicts: { "c1/r1": "STRONG", "c1/r2": "MISSING", "c1/r3": "PARTIAL" },
  };

  it("passes a run at or above every threshold", () => {
    expect(gate(good, baseline, 1)).toEqual([]);
  });

  it("fails a regression against the baseline, but only on the same golden set version", () => {
    const worse = { ...good, verdictKappa: 0.9 };
    expect(gate(worse, baseline, 1)).toEqual(["verdict kappa fell 0.100 below the baseline (1.000)"]);
    expect(gate(worse, baseline, 2)).toEqual([]);
  });

  it("fails absolute floors", () => {
    expect(
      gate({ ...good, verdictKappa: 0.5, evidencePrecision: 0.8, injectionRecall: 0.5, injectionFalsePositives: 1 }, null, 1),
    ).toEqual([
      "verdict kappa 0.500 is below 0.6",
      "evidence precision 0.800 is below 0.9",
      "injection recall 0.500 is below 1",
      "1 ordinary resume(s) were flagged as injection",
    ]);
  });

  it("lists the verdicts that moved", () => {
    const run = caseRun({
      judgments: [
        judged({ requirementId: "r1", expected: "STRONG", actual: "PARTIAL" }),
        judged({ requirementId: "r2", expected: "MISSING", actual: "MISSING" }),
      ],
    });
    expect(verdictDrift(baseline, [run])).toEqual([{ key: "c1/r1", expected: "STRONG", before: "STRONG", after: "PARTIAL" }]);
    expect(verdictsOf([run])).toEqual({ "c1/r1": "PARTIAL", "c1/r2": "MISSING" });
  });

  it("treats a quote and a labelled passage as matching when either contains the other", () => {
    expect(citesSpan("TypeScript for seven years", ["Wrote production TypeScript for seven years."])).toBe(true);
    expect(citesSpan("Wrote production TypeScript for seven years at Ledgerly", ["TypeScript for seven years"])).toBe(true);
    expect(citesSpan("Kubernetes", ["TypeScript for seven years"])).toBe(false);
    expect(citesSpan("—", ["anything"])).toBe(false);
  });
});
