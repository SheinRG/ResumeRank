import type { SelfIdRace, SelfIdSex } from "@resumerank/core/validators/compliance";

export const SEX_LABELS: Record<SelfIdSex, string> = {
  FEMALE: "Female",
  MALE: "Male",
};

export const RACE_LABELS: Record<SelfIdRace, string> = {
  HISPANIC_OR_LATINO: "Hispanic or Latino",
  WHITE: "White",
  BLACK_OR_AFRICAN_AMERICAN: "Black or African American",
  NATIVE_HAWAIIAN_OR_PACIFIC_ISLANDER: "Native Hawaiian or Pacific Islander",
  ASIAN: "Asian",
  AMERICAN_INDIAN_OR_ALASKA_NATIVE: "American Indian or Alaska Native",
  TWO_OR_MORE_RACES: "Two or more races",
};

function isSex(value: string): value is SelfIdSex {
  return value in SEX_LABELS;
}

function isRace(value: string): value is SelfIdRace {
  return value in RACE_LABELS;
}

/** Report categories are a sex, a race, or `SEX:RACE`. */
export function categoryLabel(category: string): string {
  const [first, second] = category.split(":");
  if (second !== undefined && isSex(first) && isRace(second)) {
    return `${SEX_LABELS[first]} · ${RACE_LABELS[second]}`;
  }
  if (isSex(category)) return SEX_LABELS[category];
  if (isRace(category)) return RACE_LABELS[category];
  return category;
}

/** The EEOC's four-fifths rule of thumb: a ratio under 0.8 is worth a closer look. */
export const FOUR_FIFTHS = 0.8;
