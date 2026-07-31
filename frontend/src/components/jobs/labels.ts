import type { EmploymentType, RequirementWeight } from "@resumerank/core/validators/enums";

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  FULL_TIME: "Full-time",
  PART_TIME: "Part-time",
  CONTRACT: "Contract",
  INTERNSHIP: "Internship",
};

export const REQUIREMENT_WEIGHT_LABELS: Record<RequirementWeight, string> = {
  MUST: "Must-have",
  NICE: "Nice-to-have",
};
