import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AI_COMPANY_LIMIT,
  AI_USER_LIMIT,
  checkAiQuota,
  rateLimit,
  resetRateLimits,
} from "../../src/rate-limit";

const WINDOW = { max: 3, windowMs: 60_000 };

describe("rateLimit", () => {
  beforeEach(() => {
    resetRateLimits();
    vi.useRealTimers();
  });

  it("allows requests up to the limit", () => {
    expect(rateLimit("k", WINDOW).allowed).toBe(true);
    expect(rateLimit("k", WINDOW).allowed).toBe(true);
    expect(rateLimit("k", WINDOW).allowed).toBe(true);
  });

  it("blocks the request after the limit with a retry hint", () => {
    for (let i = 0; i < 3; i++) rateLimit("k", WINDOW);
    const blocked = rateLimit("k", WINDOW);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("tracks keys independently", () => {
    for (let i = 0; i < 4; i++) rateLimit("a", WINDOW);
    expect(rateLimit("b", WINDOW).allowed).toBe(true);
  });

  it("resets after the window elapses", () => {
    vi.useFakeTimers();
    for (let i = 0; i < 4; i++) rateLimit("k", WINDOW);
    expect(rateLimit("k", WINDOW).allowed).toBe(false);
    vi.advanceTimersByTime(60_001);
    expect(rateLimit("k", WINDOW).allowed).toBe(true);
    vi.useRealTimers();
  });
});

describe("checkAiQuota", () => {
  beforeEach(() => {
    resetRateLimits();
  });

  it("allows calls within both windows", () => {
    expect(checkAiQuota({ userId: "u1", companyId: "c1" })).toBeNull();
  });

  it("blocks a user who exceeds the per-user window", () => {
    for (let i = 0; i < AI_USER_LIMIT.max; i++) {
      checkAiQuota({ userId: "u1", companyId: "c1" });
    }
    expect(checkAiQuota({ userId: "u1", companyId: "c1" })).toMatch(/too quickly/);
    expect(checkAiQuota({ userId: "u2", companyId: "c1" })).toBeNull();
  });

  it("blocks a whole company once its shared window is spent", () => {
    for (let i = 0; i < AI_COMPANY_LIMIT.max; i++) {
      checkAiQuota({ userId: `u${i}`, companyId: "c1" });
    }
    expect(checkAiQuota({ userId: "fresh", companyId: "c1" })).toMatch(/hourly AI limit/);
    expect(checkAiQuota({ userId: "fresh", companyId: "c2" })).toBeNull();
  });
});
