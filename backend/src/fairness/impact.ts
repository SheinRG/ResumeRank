import { SELF_ID_RACES, SELF_ID_SEXES, type SelfIdRace, type SelfIdSex } from "../validators/compliance";
import type { Stage } from "../validators/enums";

/**
 * Selection and scoring rates with impact ratios per demographic category,
 * the way NYC Local Law 144 bias audits report them (6 RCNY § 5-301):
 *
 * - selection rate: the share of a category that was selected;
 * - scoring rate: the share of a category scoring above the median score of
 *   everyone scored;
 * - impact ratio: a category's rate divided by the highest category's rate.
 *
 * A category under 2% of the people who answered may be left out of the
 * impact ratio, so its ratio is null and it isn't used as the reference.
 * People who didn't answer are counted but never assigned to a category.
 */

/** Advanced past screening. Uses the current stage, so someone rejected after an interview counts as not selected. */
export const SELECTED_STAGES: readonly Stage[] = ["SHORTLISTED", "INTERVIEW", "OFFER", "HIRED"];
export const SMALL_CATEGORY_SHARE = 0.02;

export interface ImpactApplicant {
  stage: Stage;
  aiScore: number | null;
  sex: SelfIdSex | null;
  race: SelfIdRace | null;
}

export interface ImpactRow {
  category: string;
  applicants: number;
  selected: number;
  selectionRate: number | null;
  selectionImpactRatio: number | null;
  scored: number;
  aboveMedian: number;
  scoringRate: number | null;
  scoringImpactRatio: number | null;
  /** Under 2% of respondents: shown, but left out of the impact ratios. */
  smallSample: boolean;
}

export interface ImpactTable {
  rows: ImpactRow[];
  /** Applicants who didn't give this category. */
  unknown: number;
}

export interface ImpactReport {
  applicants: number;
  /** Median AI score of every scored applicant; the scoring-rate threshold. */
  medianScore: number | null;
  sex: ImpactTable;
  race: ImpactTable;
  intersectional: ImpactTable;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function rate(part: number, whole: number): number | null {
  return whole === 0 ? null : part / whole;
}

function table<K extends string>(
  applicants: ImpactApplicant[],
  categories: readonly K[],
  categoryOf: (applicant: ImpactApplicant) => K | null,
  medianScore: number | null,
): ImpactTable {
  const known = applicants.filter((applicant) => categoryOf(applicant) !== null);
  const rows = categories.map((category): ImpactRow => {
    const members = known.filter((applicant) => categoryOf(applicant) === category);
    const scored = members.filter((applicant) => applicant.aiScore !== null);
    const selected = members.filter((applicant) => SELECTED_STAGES.includes(applicant.stage)).length;
    const aboveMedian =
      medianScore === null ? 0 : scored.filter((applicant) => (applicant.aiScore ?? 0) > medianScore).length;
    return {
      category,
      applicants: members.length,
      selected,
      selectionRate: rate(selected, members.length),
      selectionImpactRatio: null,
      scored: scored.length,
      aboveMedian,
      scoringRate: rate(aboveMedian, scored.length),
      scoringImpactRatio: null,
      smallSample: members.length < known.length * SMALL_CATEGORY_SHARE,
    };
  });

  const eligible = rows.filter((row) => !row.smallSample);
  const best = (pick: (row: ImpactRow) => number | null) =>
    Math.max(0, ...eligible.map((row) => pick(row) ?? 0));
  const bestSelection = best((row) => row.selectionRate);
  const bestScoring = best((row) => row.scoringRate);
  for (const row of eligible) {
    row.selectionImpactRatio =
      row.selectionRate === null || bestSelection === 0 ? null : row.selectionRate / bestSelection;
    row.scoringImpactRatio = row.scoringRate === null || bestScoring === 0 ? null : row.scoringRate / bestScoring;
  }

  return { rows: rows.filter((row) => row.applicants > 0), unknown: applicants.length - known.length };
}

type Intersection = `${SelfIdSex}:${SelfIdRace}`;
const INTERSECTIONS: Intersection[] = SELF_ID_SEXES.flatMap((sex) =>
  SELF_ID_RACES.map((race): Intersection => `${sex}:${race}`),
);

export function impactReport(applicants: ImpactApplicant[]): ImpactReport {
  const medianScore = median(
    applicants.flatMap((applicant) => (applicant.aiScore === null ? [] : [applicant.aiScore])),
  );
  return {
    applicants: applicants.length,
    medianScore,
    sex: table(applicants, SELF_ID_SEXES, (applicant) => applicant.sex, medianScore),
    race: table(applicants, SELF_ID_RACES, (applicant) => applicant.race, medianScore),
    intersectional: table(
      applicants,
      INTERSECTIONS,
      (applicant): Intersection | null =>
        applicant.sex && applicant.race ? `${applicant.sex}:${applicant.race}` : null,
      medianScore,
    ),
  };
}
