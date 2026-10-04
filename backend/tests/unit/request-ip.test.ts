import { describe, expect, it, vi } from "vitest";

import { resolveClientIp, UNKNOWN_IP } from "../../src/request-ip";
import { slidingCount } from "../../src/rate-limit";

// rate-limit.ts imports the Prisma client; only its pure helper is used here.
vi.mock("../../src/db", () => ({ db: {} }));

function headers(entries: Record<string, string>) {
  return new Headers(entries);
}

describe("resolveClientIp", () => {
  const offVercel = { onVercel: false };
  const onVercel = { onVercel: true };

  it("ignores the client-controlled first X-Forwarded-For hop and uses the last", () => {
    const spoofed = headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" });
    expect(resolveClientIp(spoofed, offVercel)).toBe("203.0.113.9");
  });

  it("uses Vercel's own header on Vercel, not a forwarded value", () => {
    const request = headers({
      "x-forwarded-for": "6.6.6.6",
      "x-vercel-forwarded-for": "198.51.100.4",
    });
    expect(resolveClientIp(request, onVercel)).toBe("198.51.100.4");
  });

  it("prefers an explicitly trusted header everywhere", () => {
    const request = headers({
      "cf-connecting-ip": "2001:db8::1",
      "x-vercel-forwarded-for": "198.51.100.4",
    });
    expect(resolveClientIp(request, { ...onVercel, trustedHeader: "cf-connecting-ip" })).toBe(
      "2001:db8::1",
    );
  });

  it("falls back to a shared bucket when no valid IP is available", () => {
    expect(resolveClientIp(headers({}), offVercel)).toBe(UNKNOWN_IP);
    expect(resolveClientIp(headers({ "x-forwarded-for": "not-an-ip" }), offVercel)).toBe(UNKNOWN_IP);
    expect(resolveClientIp(headers({}), onVercel)).toBe(UNKNOWN_IP);
  });
});

describe("slidingCount", () => {
  it("weights the previous window by how much of it still overlaps", () => {
    expect(slidingCount(10, 0, 0)).toBe(10);
    expect(slidingCount(10, 4, 0.5)).toBe(9);
    expect(slidingCount(10, 4, 1)).toBe(4);
  });
});
