import { describe, expect, it } from "vitest";

import { describeDevice } from "../../src/auth/device";
import {
  DEFAULT_SESSION_POLICY,
  needsLastSeenUpdate,
  sessionEnd,
  sessionExpiresAt,
  sessionPolicyOf,
  type SessionPolicy,
} from "../../src/auth/session-policy";
import { sessionPolicySchema } from "../../src/validators/session";

const MINUTE = 60_000;
const SIGNED_IN = Date.UTC(2026, 9, 1, 9, 0, 0);
const POLICY: SessionPolicy = { lifetimeMinutes: 8 * 60, idleMinutes: 30 };

function times(lastSeenMinutesAfter: number, revokedAt: Date | null = null) {
  return {
    createdAt: new Date(SIGNED_IN),
    lastSeenAt: new Date(SIGNED_IN + lastSeenMinutesAfter * MINUTE),
    revokedAt,
  };
}

describe("sessionEnd", () => {
  it("keeps a session live while it's active and within its lifetime", () => {
    expect(sessionEnd(times(100), POLICY, SIGNED_IN + 110 * MINUTE)).toBeNull();
  });

  it("ends a session the moment it has been idle for the timeout", () => {
    expect(sessionEnd(times(100), POLICY, SIGNED_IN + 129 * MINUTE)).toBeNull();
    expect(sessionEnd(times(100), POLICY, SIGNED_IN + 130 * MINUTE)).toBe("idle");
  });

  it("ends an active session once it outlives the lifetime", () => {
    expect(sessionEnd(times(479), POLICY, SIGNED_IN + 480 * MINUTE)).toBe("expired");
  });

  it("reports revocation first, whatever the clock says", () => {
    expect(sessionEnd(times(1, new Date(SIGNED_IN)), POLICY, SIGNED_IN + 2 * MINUTE)).toBe("revoked");
  });

  it("judges old sessions by the current policy, so tightening it ends them", () => {
    const session = times(60 * 24);
    const now = SIGNED_IN + 60 * 24 * MINUTE + MINUTE;
    expect(sessionEnd(session, DEFAULT_SESSION_POLICY, now)).toBeNull();
    expect(sessionEnd(session, { lifetimeMinutes: 12 * 60, idleMinutes: 60 }, now)).toBe("expired");
  });
});

describe("sessionExpiresAt", () => {
  it("is the idle deadline while that comes first", () => {
    expect(sessionExpiresAt(times(10), POLICY).getTime()).toBe(SIGNED_IN + 40 * MINUTE);
  });

  it("is capped by the lifetime", () => {
    expect(sessionExpiresAt(times(470), POLICY).getTime()).toBe(SIGNED_IN + 480 * MINUTE);
  });
});

describe("sessionPolicyOf", () => {
  it("falls back to the defaults for someone without a company", () => {
    expect(sessionPolicyOf(null)).toEqual(DEFAULT_SESSION_POLICY);
  });

  it("reads the company's columns", () => {
    expect(sessionPolicyOf({ sessionLifetimeMinutes: 60, sessionIdleMinutes: 15 })).toEqual({
      lifetimeMinutes: 60,
      idleMinutes: 15,
    });
  });
});

describe("needsLastSeenUpdate", () => {
  it("writes activity at most once a minute", () => {
    const lastSeen = new Date(SIGNED_IN);
    expect(needsLastSeenUpdate(lastSeen, SIGNED_IN + 59_999)).toBe(false);
    expect(needsLastSeenUpdate(lastSeen, SIGNED_IN + MINUTE)).toBe(true);
  });
});

describe("describeDevice", () => {
  it.each([
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
      "Chrome on Windows",
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
      "Edge on Windows",
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
      "Safari on macOS",
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      "Safari on iOS",
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1",
      "Chrome on iOS",
    ],
    [
      "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
      "Chrome on Android",
    ],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:142.0) Gecko/20100101 Firefox/142.0", "Firefox on Linux"],
    ["curl/8.9.1", "Unknown device"],
  ])("labels %s", (userAgent, label) => {
    expect(describeDevice(userAgent)).toBe(label);
  });

  it("labels a missing user agent", () => {
    expect(describeDevice(null)).toBe("Unknown device");
  });
});

describe("sessionPolicySchema", () => {
  it("accepts limits within range", () => {
    expect(sessionPolicySchema.safeParse({ lifetimeMinutes: 480, idleMinutes: 30 }).success).toBe(true);
  });

  it("refuses an idle timeout longer than the lifetime", () => {
    const result = sessionPolicySchema.safeParse({ lifetimeMinutes: 60, idleMinutes: 120 });
    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors.idleMinutes).toBeDefined();
  });

  it.each([
    { lifetimeMinutes: 30, idleMinutes: 15 },
    { lifetimeMinutes: 60 * 24 * 31, idleMinutes: 60 },
    { lifetimeMinutes: 480, idleMinutes: 5 },
    { lifetimeMinutes: 480.5, idleMinutes: 30 },
  ])("refuses out-of-range limits %o", (input) => {
    expect(sessionPolicySchema.safeParse(input).success).toBe(false);
  });
});
