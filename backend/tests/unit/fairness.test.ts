import { describe, expect, it } from "vitest";

import { impactReport, median, type ImpactApplicant } from "../../src/fairness/impact";

function applicants(count: number, template: Omit<ImpactApplicant, "stage"> & { stage?: ImpactApplicant["stage"] }) {
  return Array.from({ length: count }, (): ImpactApplicant => ({ stage: "NEW", ...template }));
}

describe("median", () => {
  it("averages the middle pair of an even list and is null for none", () => {
    expect(median([40, 10, 30, 20])).toBe(25);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([])).toBeNull();
  });
});

describe("impactReport", () => {
  it("divides each category's selection rate by the highest one", () => {
    const report = impactReport([
      ...applicants(6, { sex: "FEMALE", race: "ASIAN", aiScore: null, stage: "SHORTLISTED" }),
      ...applicants(4, { sex: "FEMALE", race: "ASIAN", aiScore: null }),
      ...applicants(3, { sex: "MALE", race: "WHITE", aiScore: null, stage: "HIRED" }),
      ...applicants(7, { sex: "MALE", race: "WHITE", aiScore: null, stage: "REJECTED" }),
    ]);
    const female = report.sex.rows.find((row) => row.category === "FEMALE");
    const male = report.sex.rows.find((row) => row.category === "MALE");
    expect(female).toMatchObject({ applicants: 10, selected: 6, selectionRate: 0.6, selectionImpactRatio: 1 });
    expect(male).toMatchObject({ applicants: 10, selected: 3, selectionRate: 0.3, selectionImpactRatio: 0.5 });
  });

  it("measures scoring rates against the median score of everyone scored", () => {
    const report = impactReport([
      ...[90, 40, 35, 30].flatMap((aiScore) => applicants(1, { sex: "FEMALE", race: null, aiScore })),
      ...[80, 78, 76, 20].flatMap((aiScore) => applicants(1, { sex: "MALE", race: null, aiScore })),
      ...applicants(5, { sex: "MALE", race: null, aiScore: null }),
    ]);
    expect(report.medianScore).toBe(58);
    const female = report.sex.rows.find((row) => row.category === "FEMALE");
    const male = report.sex.rows.find((row) => row.category === "MALE");
    expect(female).toMatchObject({ scored: 4, aboveMedian: 1, scoringRate: 0.25 });
    expect(male).toMatchObject({ applicants: 9, scored: 4, aboveMedian: 3, scoringRate: 0.75, scoringImpactRatio: 1 });
    expect(female?.scoringImpactRatio).toBeCloseTo(1 / 3);
  });

  it("counts people who didn't answer without assigning them a category", () => {
    const report = impactReport([
      ...applicants(4, { sex: "FEMALE", race: null, aiScore: null }),
      ...applicants(3, { sex: null, race: null, aiScore: null }),
    ]);
    expect(report.applicants).toBe(7);
    expect(report.sex.unknown).toBe(3);
    expect(report.race.unknown).toBe(7);
    expect(report.race.rows).toEqual([]);
    expect(report.intersectional.unknown).toBe(7);
  });

  it("leaves categories under 2% of respondents out of the impact ratios", () => {
    const report = impactReport([
      ...applicants(60, { sex: null, race: "WHITE", aiScore: null, stage: "OFFER" }),
      ...applicants(39, { sex: null, race: "ASIAN", aiScore: null, stage: "OFFER" }),
      ...applicants(1, { sex: null, race: "AMERICAN_INDIAN_OR_ALASKA_NATIVE", aiScore: null }),
    ]);
    const small = report.race.rows.find((row) => row.category === "AMERICAN_INDIAN_OR_ALASKA_NATIVE");
    expect(small).toMatchObject({ applicants: 1, smallSample: true, selectionImpactRatio: null });
    expect(report.race.rows.find((row) => row.category === "ASIAN")?.selectionImpactRatio).toBe(1);
  });

  it("reports intersections of sex and race", () => {
    const report = impactReport(applicants(2, { sex: "MALE", race: "ASIAN", aiScore: null }));
    expect(report.intersectional.rows).toEqual([expect.objectContaining({ category: "MALE:ASIAN", applicants: 2 })]);
  });
});
