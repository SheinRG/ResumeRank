import { createHash } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { pwnedPasswordsLookup } from "../../src/auth/breached-password";
import {
  DEFAULT_PASSWORD_POLICY,
  passwordShortfall,
  strictestPolicy,
} from "../../src/auth/password-policy";
import { passwordSchemaFor } from "../../src/validators/auth";
import { passwordPolicySchema } from "../../src/validators/password-policy";

// password-policy.ts imports the Prisma client; only its pure helpers run here.
vi.mock("../../src/db", () => ({ db: {} }));

const breached = async () => true;
const clean = async () => false;
const unreachable = async () => null;

describe("strictestPolicy", () => {
  it("is the default with no workspaces", () => {
    expect(strictestPolicy([])).toEqual(DEFAULT_PASSWORD_POLICY);
  });

  it("takes the longest minimum and any breach check", () => {
    expect(
      strictestPolicy([
        { minLength: 12, breachCheck: false },
        { minLength: 10, breachCheck: true },
      ]),
    ).toEqual({ minLength: 12, breachCheck: true });
  });
});

describe("passwordShortfall", () => {
  const policy = { minLength: 12, breachCheck: true };

  it("refuses passwords under the minimum", async () => {
    expect(await passwordShortfall("short-pass", policy, clean)).toBe(
      "Your workspace requires passwords of at least 12 characters.",
    );
  });

  it("refuses breached passwords only when the policy asks", async () => {
    expect(await passwordShortfall("correct horse battery", policy, breached)).toMatch(/known data breach/);
    expect(await passwordShortfall("correct horse battery", { ...policy, breachCheck: false }, breached)).toBeNull();
  });

  it("lets a password through when the breach service can't be reached", async () => {
    expect(await passwordShortfall("correct horse battery", policy, unreachable)).toBeNull();
  });

  it("doesn't call the breach service for a password already too short", async () => {
    const lookup = vi.fn(clean);
    await passwordShortfall("short", policy, lookup);
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe("pwnedPasswordsLookup", () => {
  const password = "hunter2hunter2";
  const hash = createHash("sha1").update(password).digest("hex").toUpperCase();

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function respond(body: string, status = 200) {
    const fetchMock = vi.fn(async () => new Response(body, { status }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("sends only the hash prefix and asks for padding", async () => {
    const fetchMock = respond("");
    await pwnedPasswordsLookup(password);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`);
    expect(url).not.toContain(hash.slice(5));
    expect(new Headers(init.headers).get("Add-Padding")).toBe("true");
  });

  it("finds a breached suffix", async () => {
    respond(`0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n${hash.slice(5)}:42\r\n`);
    expect(await pwnedPasswordsLookup(password)).toBe(true);
  });

  it("ignores padding entries, which have a count of zero", async () => {
    respond(`${hash.slice(5)}:0\r\n`);
    expect(await pwnedPasswordsLookup(password)).toBe(false);
  });

  it("reports an outage as unknown", async () => {
    respond("", 503);
    expect(await pwnedPasswordsLookup(password)).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    expect(await pwnedPasswordsLookup(password)).toBeNull();
  });
});

describe("password schemas", () => {
  it("builds the length rule from the policy", () => {
    expect(passwordSchemaFor(12).safeParse("elevenchars").success).toBe(false);
    expect(passwordSchemaFor(12).safeParse("twelve chars").success).toBe(true);
  });

  it("keeps policies between the floor and 64", () => {
    expect(passwordPolicySchema.safeParse({ minLength: 7, breachCheck: false }).success).toBe(false);
    expect(passwordPolicySchema.safeParse({ minLength: 65, breachCheck: false }).success).toBe(false);
    expect(passwordPolicySchema.safeParse({ minLength: 16, breachCheck: true }).success).toBe(true);
  });
});
