import { describe, expect, it } from "vitest";
import {
  candidateCreateSchema,
  jobCreateSchema,
  jobListParamsSchema,
  llmScoringResultSchema,
  registerSchema,
  scorecardSchema,
} from "../../src/validators";

describe("registerSchema", () => {
  it("normalizes email casing and whitespace", () => {
    const out = registerSchema.parse({
      name: "  Raghav ",
      email: " Raghav@Example.COM ",
      password: "password123",
    });
    expect(out.email).toBe("raghav@example.com");
    expect(out.name).toBe("Raghav");
  });

  it("rejects short passwords", () => {
    const out = registerSchema.safeParse({
      name: "Raghav",
      email: "r@example.com",
      password: "short",
    });
    expect(out.success).toBe(false);
  });
});

describe("jobCreateSchema", () => {
  const base = {
    title: "Senior Engineer",
    description: "A role description long enough to pass the minimum bar.",
    employmentType: "FULL_TIME",
    status: "OPEN",
    requirements: [{ label: "5+ years React", weight: "MUST" }],
  };

  it("accepts a valid job", () => {
    expect(jobCreateSchema.safeParse(base).success).toBe(true);
  });

  it("requires at least one requirement — scoring needs a rubric", () => {
    expect(
      jobCreateSchema.safeParse({ ...base, requirements: [] }).success,
    ).toBe(false);
  });

  it("turns an empty location into undefined", () => {
    const out = jobCreateSchema.parse({ ...base, location: "" });
    expect(out.location).toBeUndefined();
  });
});

describe("candidateCreateSchema", () => {
  it("rejects resume text below the scoring minimum", () => {
    const out = candidateCreateSchema.safeParse({
      name: "Jane Doe",
      email: "jane@example.com",
      source: "MANUAL",
      resumeText: "Too short to score.",
    });
    expect(out.success).toBe(false);
  });
});

describe("scorecardSchema", () => {
  it("bounds ratings to 1–5 integers", () => {
    expect(
      scorecardSchema.safeParse({ applicationId: "a", rating: 6 }).success,
    ).toBe(false);
    expect(
      scorecardSchema.safeParse({ applicationId: "a", rating: 2.5 }).success,
    ).toBe(false);
    expect(
      scorecardSchema.safeParse({ applicationId: "a", rating: 5 }).success,
    ).toBe(true);
  });
});

describe("jobListParamsSchema", () => {
  it("falls back to safe defaults on garbage input", () => {
    const out = jobListParamsSchema.parse({
      q: 42,
      status: "NOT_A_STATUS",
      sort: "bogus",
      page: "-3",
    });
    expect(out).toEqual({ q: "", status: undefined, sort: "newest", page: 1 });
  });
});

describe("llmScoringResultSchema", () => {
  it("rejects an empty evaluations array", () => {
    const out = llmScoringResultSchema.safeParse({
      summary: "s",
      evaluations: [],
    });
    expect(out.success).toBe(false);
  });

  it("normalizes empty-string evidence to null", () => {
    const out = llmScoringResultSchema.parse({
      summary: "Summary.",
      evaluations: [
        { requirementId: "r1", verdict: "STRONG", evidence: "", note: "n" },
      ],
    });
    expect(out.evaluations[0].evidence).toBeNull();
  });
});
