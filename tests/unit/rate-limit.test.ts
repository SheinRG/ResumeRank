import { beforeEach, describe, expect, it, vi } from "vitest";
import { rateLimit, resetRateLimits } from "@/lib/rate-limit";

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
