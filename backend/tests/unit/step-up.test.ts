import { describe, expect, it, vi } from "vitest";

import { authenticatedAt, isRecentlyAuthenticated, STEP_UP_WINDOW_MINUTES } from "../../src/auth/step-up";
import { reauthSchema } from "../../src/validators/step-up";

// step-up.ts imports the Prisma client; only its pure helpers run here.
vi.mock("../../src/db", () => ({ db: {} }));

const signedIn = new Date("2026-10-18T09:00:00Z");
const minutes = (count: number) => count * 60_000;

describe("authenticatedAt", () => {
  it("is the sign-in until the session steps up", () => {
    expect(authenticatedAt({ createdAt: signedIn, reauthenticatedAt: null })).toEqual(signedIn);
  });

  it("moves to the latest step-up", () => {
    const later = new Date(signedIn.getTime() + minutes(30));
    expect(authenticatedAt({ createdAt: signedIn, reauthenticatedAt: later })).toEqual(later);
  });
});

describe("isRecentlyAuthenticated", () => {
  it(`holds for ${STEP_UP_WINDOW_MINUTES} minutes`, () => {
    const justInside = new Date(signedIn.getTime() + minutes(STEP_UP_WINDOW_MINUTES) - 1);
    const atTheEdge = new Date(signedIn.getTime() + minutes(STEP_UP_WINDOW_MINUTES));
    expect(isRecentlyAuthenticated(signedIn, justInside)).toBe(true);
    expect(isRecentlyAuthenticated(signedIn, atTheEdge)).toBe(false);
  });
});

describe("reauthSchema", () => {
  it("accepts a password, an authenticator code or a passkey, never a recovery code", () => {
    expect(reauthSchema.safeParse({ method: "password", password: "hunter2" }).success).toBe(true);
    expect(reauthSchema.safeParse({ method: "totp", code: "123 456" }).success).toBe(true);
    expect(reauthSchema.safeParse({ method: "recovery", code: "abcd-efgh-ijkl-mnop" }).success).toBe(false);
    expect(reauthSchema.safeParse({ method: "password", password: "" }).success).toBe(false);
  });
});
