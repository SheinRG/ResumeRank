import { describe, expect, it } from "vitest";
import { computeScore, scoreTone } from "../../src/scoring/math";

describe("computeScore", () => {
  it("returns 0 for an empty evaluation set", () => {
    expect(computeScore([])).toBe(0);
  });

  it("returns 100 when every requirement is strong", () => {
    expect(
      computeScore([
        { weight: "MUST", verdict: "STRONG" },
        { weight: "NICE", verdict: "STRONG" },
      ]),
    ).toBe(100);
  });

  it("returns 0 when every requirement is missing", () => {
    expect(
      computeScore([
        { weight: "MUST", verdict: "MISSING" },
        { weight: "NICE", verdict: "MISSING" },
      ]),
    ).toBe(0);
  });

  it("gives partial verdicts half credit", () => {
    expect(computeScore([{ weight: "MUST", verdict: "PARTIAL" }])).toBe(50);
  });

  it("weights must-haves double", () => {
    // MUST strong (2/2) + NICE missing (0/1) = 2/3 ≈ 67
    expect(
      computeScore([
        { weight: "MUST", verdict: "STRONG" },
        { weight: "NICE", verdict: "MISSING" },
      ]),
    ).toBe(67);
    // NICE strong (1/1) + MUST missing (0/2) = 1/3 ≈ 33
    expect(
      computeScore([
        { weight: "NICE", verdict: "STRONG" },
        { weight: "MUST", verdict: "MISSING" },
      ]),
    ).toBe(33);
  });

  it("rounds to the nearest integer", () => {
    // 2 MUST strong + 1 MUST partial = 5/6 ≈ 83.33 → 83
    expect(
      computeScore([
        { weight: "MUST", verdict: "STRONG" },
        { weight: "MUST", verdict: "STRONG" },
        { weight: "MUST", verdict: "PARTIAL" },
      ]),
    ).toBe(83);
  });
});

describe("scoreTone", () => {
  it("maps score bands to tones", () => {
    expect(scoreTone(90)).toBe("strong");
    expect(scoreTone(75)).toBe("strong");
    expect(scoreTone(74)).toBe("medium");
    expect(scoreTone(50)).toBe("medium");
    expect(scoreTone(49)).toBe("weak");
    expect(scoreTone(0)).toBe("weak");
  });
});
