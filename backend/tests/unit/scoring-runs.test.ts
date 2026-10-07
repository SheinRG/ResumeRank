import {
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  RateLimitError,
} from "groq-sdk";
import { describe, expect, it, vi } from "vitest";

import { classifyProviderFailure } from "../../src/ai/llm";
import {
  SCORING_PROMPT_VERSION,
  scoringInputHash,
  type ScoringJob,
  type ScoringSettings,
} from "../../src/scoring/engine";
import { retryDelayMs } from "../../src/scoring/queue";
import { ScoringError } from "../../src/scoring/parse";

// The queue module imports the Prisma client; these tests only exercise its
// pure helpers, so no connection is opened.
vi.mock("../../src/db", () => ({ db: {} }));

const JOB: ScoringJob = {
  title: "Backend Engineer",
  description: "Build the scoring pipeline.",
  requirements: [
    { id: "r1", label: "TypeScript", weight: "MUST" },
    { id: "r2", label: "Postgres", weight: "NICE" },
  ],
};
const SETTINGS: ScoringSettings = { model: "m1", promptVersion: "p1", temperature: 0, seed: 7 };
const RESUME = "Eight years of TypeScript and Postgres.";

describe("scoringInputHash", () => {
  const base = scoringInputHash(JOB, RESUME, SETTINGS);

  it("is stable for identical inputs", () => {
    expect(scoringInputHash(structuredClone(JOB), RESUME, { ...SETTINGS })).toBe(base);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes with anything that shapes the model's answer", () => {
    const variants = [
      scoringInputHash(JOB, `${RESUME} Also Go.`, SETTINGS),
      scoringInputHash({ ...JOB, title: "Staff Engineer" }, RESUME, SETTINGS),
      scoringInputHash({ ...JOB, description: "Different." }, RESUME, SETTINGS),
      scoringInputHash(
        { ...JOB, requirements: [{ ...JOB.requirements[0], weight: "NICE" }, JOB.requirements[1]] },
        RESUME,
        SETTINGS,
      ),
      scoringInputHash({ ...JOB, requirements: [...JOB.requirements].reverse() }, RESUME, SETTINGS),
      scoringInputHash(JOB, RESUME, { ...SETTINGS, model: "m2" }),
      scoringInputHash(JOB, RESUME, { ...SETTINGS, promptVersion: "p2" }),
      scoringInputHash(JOB, RESUME, { ...SETTINGS, temperature: 0.2 }),
      scoringInputHash(JOB, RESUME, { ...SETTINGS, seed: 8 }),
    ];
    expect(new Set([base, ...variants]).size).toBe(variants.length + 1);
  });
});

describe("SCORING_PROMPT_VERSION", () => {
  it("is a short content hash of the prompt templates", () => {
    expect(SCORING_PROMPT_VERSION).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe("classifyProviderFailure", () => {
  const headers = (entries: Record<string, string> = {}) => new Headers(entries);

  it("retries rate limits and honours Retry-After seconds", () => {
    const failure = classifyProviderFailure(
      new RateLimitError(429, undefined, "slow down", headers({ "retry-after": "7" })),
    );
    expect(failure).toEqual({ retryable: true, misconfigured: false, retryAfterMs: 7000 });
  });

  it("retries timeouts, connection drops and server errors", () => {
    expect(classifyProviderFailure(new APIConnectionTimeoutError()).retryable).toBe(true);
    expect(classifyProviderFailure(new APIError(503, undefined, "down", headers())).retryable).toBe(
      true,
    );
  });

  it("flags a rejected key or model as misconfiguration, not a transient failure", () => {
    for (const status of [401, 403, 404]) {
      const failure = classifyProviderFailure(new APIError(status, undefined, "no", new Headers()));
      expect(failure).toMatchObject({ retryable: false, misconfigured: true });
    }
  });

  it("does not retry failures that would repeat", () => {
    expect(
      classifyProviderFailure(new AuthenticationError(401, undefined, "bad key", headers())).retryable,
    ).toBe(false);
    expect(classifyProviderFailure(new APIError(400, undefined, "bad", headers())).retryable).toBe(
      false,
    );
    expect(classifyProviderFailure(new ScoringError("malformed")).retryable).toBe(false);
    expect(classifyProviderFailure(new Error("bug")).retryable).toBe(false);
  });
});

describe("retryDelayMs", () => {
  const mid = () => 0.5;

  it("doubles per attempt from a 10s base", () => {
    expect(retryDelayMs(1, null, mid)).toBe(10_000);
    expect(retryDelayMs(2, null, mid)).toBe(20_000);
    expect(retryDelayMs(3, null, mid)).toBe(40_000);
  });

  it("caps at five minutes", () => {
    expect(retryDelayMs(20, null, mid)).toBe(300_000);
  });

  it("jitters within ±20%", () => {
    expect(retryDelayMs(1, null, () => 0)).toBe(8_000);
    expect(retryDelayMs(1, null, () => 1)).toBe(12_000);
  });

  it("never retries sooner than the provider asked", () => {
    expect(retryDelayMs(1, 60_000, mid)).toBe(60_000);
  });
});
