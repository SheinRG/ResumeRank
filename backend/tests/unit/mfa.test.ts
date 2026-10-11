import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { mfaGate } from "../../src/auth/mfa/policy";
import { mintMfaProof, readMfaProof } from "../../src/auth/mfa/proof";
import { generateRecoveryCodes, hashRecoveryCode } from "../../src/auth/mfa/recovery-codes";
import { openTotpSecret, sealTotpSecret } from "../../src/auth/mfa/secrets";
import { base32, hotp, matchTotp, timeStep, totpUri, TOTP_PERIOD_SECONDS } from "../../src/auth/mfa/totp";
import { open, seal, subkey } from "../../src/sealed-box";
import {
  mfaCodeChallengeSchema,
  recoveryCodeSchema,
  registrationResponseSchema,
  totpCodeSchema,
} from "../../src/validators/mfa";

beforeAll(() => {
  vi.stubEnv("DATABASE_URL", "postgresql://unused");
  vi.stubEnv("AUTH_SECRET", "a-long-enough-auth-secret");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

// The shared secret of the RFC 4226 and RFC 6238 (SHA-1) test vectors.
const RFC_SECRET = Buffer.from("12345678901234567890", "ascii");

describe("HOTP / TOTP", () => {
  it("matches the RFC 4226 test vectors", () => {
    const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
    expect(expected.map((_, counter) => hotp(RFC_SECRET, counter))).toEqual(expected);
  });

  it("matches the RFC 6238 SHA-1 test vectors", () => {
    const vectors: Array<[number, string]> = [
      [59, "94287082"],
      [1111111109, "07081804"],
      [1234567890, "89005924"],
      [2000000000, "69279037"],
    ];
    for (const [seconds, code] of vectors) {
      expect(hotp(RFC_SECRET, timeStep(seconds * 1000), 8)).toBe(code);
    }
  });

  it("encodes base32 per RFC 4648, without padding", () => {
    const vectors: Array<[string, string]> = [
      ["f", "MY"],
      ["fo", "MZXQ"],
      ["foo", "MZXW6"],
      ["foob", "MZXW6YQ"],
      ["fooba", "MZXW6YTB"],
      ["foobar", "MZXW6YTBOI"],
    ];
    for (const [input, output] of vectors) expect(base32(Buffer.from(input))).toBe(output);
  });

  const now = 1_760_000_000_000;
  const step = timeStep(now);
  const codeAt = (offset: number) => hotp(RFC_SECRET, step + offset);

  it("accepts the current code and one step of drift either way, reporting its step", () => {
    expect(matchTotp(RFC_SECRET, codeAt(0), now, null)).toBe(step);
    expect(matchTotp(RFC_SECRET, codeAt(-1), now, null)).toBe(step - 1);
    expect(matchTotp(RFC_SECRET, codeAt(1), now, null)).toBe(step + 1);
  });

  it("refuses codes further out, malformed codes, and steps already used", () => {
    expect(matchTotp(RFC_SECRET, codeAt(-2), now, null)).toBeNull();
    expect(matchTotp(RFC_SECRET, codeAt(2), now, null)).toBeNull();
    expect(matchTotp(RFC_SECRET, codeAt(0).slice(1), now, null)).toBeNull();
    expect(matchTotp(RFC_SECRET, "abcdef", now, null)).toBeNull();
    expect(matchTotp(RFC_SECRET, codeAt(0), now, step)).toBeNull();
    expect(matchTotp(RFC_SECRET, codeAt(-1), now, step - 1)).toBeNull();
    expect(matchTotp(RFC_SECRET, codeAt(1), now, step)).toBe(step + 1);
  });

  it("builds an otpauth URI authenticator apps can read", () => {
    const uri = new URL(totpUri({ secret: RFC_SECRET, issuer: "ResumeRank", account: "ada@acme.com" }));
    expect(uri.protocol).toBe("otpauth:");
    expect(uri.host).toBe("totp");
    expect(decodeURIComponent(uri.pathname)).toBe("/ResumeRank:ada@acme.com");
    expect(uri.searchParams.get("secret")).toBe(base32(RFC_SECRET));
    expect(uri.searchParams.get("issuer")).toBe("ResumeRank");
    expect(uri.searchParams.get("period")).toBe(String(TOTP_PERIOD_SECONDS));
  });
});

describe("recovery codes", () => {
  it("issues ten distinct, grouped base32 codes", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[a-z2-7]{4}(-[a-z2-7]{4}){3}$/);
  });

  it("hashes the same however the code is typed back", () => {
    const [code = ""] = generateRecoveryCodes(1);
    const typed = ` ${code.toUpperCase().replace(/-/g, " ")} `;
    expect(hashRecoveryCode(typed)).toBe(hashRecoveryCode(code));
    expect(recoveryCodeSchema.parse(typed)).toBe(code.replace(/-/g, ""));
  });

  it("reads a typed 0 or 1 as the o or l base32 actually uses", () => {
    expect(recoveryCodeSchema.parse("l0ok-aaaa-bbbb-cc1d")).toBe("lookaaaabbbbccld");
    expect(hashRecoveryCode("100k-aaaa-bbbb-cccc")).toBe(hashRecoveryCode("look-aaaa-bbbb-cccc"));
  });
});

describe("MFA proof", () => {
  const loginId = "login-1";
  const epoch = 1_760_000_000_123;
  const now = 1_760_000_100_000;

  it("vouches for the epoch it was minted for", () => {
    expect(readMfaProof(mintMfaProof(loginId, epoch, now), loginId, now + 1_000)).toBe(epoch);
  });

  it("is worthless for another sign-in, once stale, or once edited", () => {
    const proof = mintMfaProof(loginId, epoch, now);
    expect(readMfaProof(proof, "login-2", now)).toBeNull();
    expect(readMfaProof(proof, loginId, now + 61_000)).toBeNull();
    expect(readMfaProof(proof, loginId, now - 1)).toBeNull();
    expect(readMfaProof(proof.replace(String(epoch), String(epoch + 1)), loginId, now)).toBeNull();
    expect(readMfaProof(`${proof}x`, loginId, now)).toBeNull();
    expect(readMfaProof(undefined, loginId, now)).toBeNull();
    expect(readMfaProof({ mfaProof: proof }, loginId, now)).toBeNull();
  });
});

describe("sealed TOTP secrets", () => {
  it("open only for the user they were sealed for", () => {
    const sealed = sealTotpSecret(RFC_SECRET, "user-1");
    expect(openTotpSecret(sealed, "user-1")?.equals(RFC_SECRET)).toBe(true);
    expect(openTotpSecret(sealed, "user-2")).toBeNull();
    expect(openTotpSecret(sealed.replace(/.$/, (last) => (last === "A" ? "B" : "A")), "user-1")).toBeNull();
  });

  it("don't open under a rotated key", () => {
    const sealed = seal("secret", "aad", subkey("first-secret-value", "info"));
    expect(open(sealed, "aad", subkey("first-secret-value", "info"))).toBe("secret");
    expect(open(sealed, "aad", subkey("second-secret-value", "info"))).toBeNull();
  });
});

describe("mfaGate", () => {
  const enabledAt = new Date(1_760_000_000_000);

  it("challenges a sign-in that hasn't proven the current epoch", () => {
    expect(mfaGate({ viaSso: false, enabledAt, verifiedEpoch: null, required: false })).toBe("challenge");
    expect(mfaGate({ viaSso: false, enabledAt, verifiedEpoch: enabledAt.getTime() - 1, required: false })).toBe(
      "challenge",
    );
    expect(mfaGate({ viaSso: false, enabledAt, verifiedEpoch: enabledAt.getTime(), required: true })).toBe("pass");
  });

  it("holds members without a factor at setup only when the company requires one", () => {
    expect(mfaGate({ viaSso: false, enabledAt: null, verifiedEpoch: null, required: true })).toBe("setup");
    expect(mfaGate({ viaSso: false, enabledAt: null, verifiedEpoch: null, required: false })).toBe("pass");
  });

  it("leaves single sign-on sessions to the identity provider", () => {
    expect(mfaGate({ viaSso: true, enabledAt, verifiedEpoch: null, required: true })).toBe("pass");
    expect(mfaGate({ viaSso: true, enabledAt: null, verifiedEpoch: null, required: true })).toBe("pass");
  });
});

describe("MFA validators", () => {
  it("accepts six digits typed with spaces and nothing else", () => {
    expect(totpCodeSchema.parse("123 456")).toBe("123456");
    expect(totpCodeSchema.safeParse("12345").success).toBe(false);
    expect(totpCodeSchema.safeParse("12345a").success).toBe(false);
    expect(mfaCodeChallengeSchema.safeParse({ method: "sms", code: "123456" }).success).toBe(false);
  });

  it("bounds WebAuthn responses and drops extension outputs", () => {
    const response = {
      id: "abc_-",
      rawId: "abc_-",
      type: "public-key",
      clientExtensionResults: { credProps: { rk: true }, unexpected: "x" },
      response: { clientDataJSON: "e30", attestationObject: "o2Nm", transports: ["internal"] },
    };
    const parsed = registrationResponseSchema.parse(response);
    expect(parsed.clientExtensionResults).toEqual({});
    expect(registrationResponseSchema.safeParse({ ...response, id: "not base64url!" }).success).toBe(false);
    expect(
      registrationResponseSchema.safeParse({
        ...response,
        response: { ...response.response, transports: ["carrier-pigeon"] },
      }).success,
    ).toBe(false);
  });
});
