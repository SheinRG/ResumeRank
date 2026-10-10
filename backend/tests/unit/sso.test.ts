import { describe, expect, it } from "vitest";

import {
  emailDomain,
  hasVerificationRecord,
  verificationRecordName,
  verificationRecordValue,
} from "../../src/sso/domains";
import { requiresSso } from "../../src/sso/policy";
import { isPublicHttpsUrl } from "../../src/sso/public-url";
import { addDomainSchema, saveSsoConnectionSchema } from "../../src/validators/sso";

describe("requiresSso", () => {
  it("holds everyone but owners to an enforced policy", () => {
    expect(requiresSso({ role: "ADMIN", ssoEnforced: true })).toBe(true);
    expect(requiresSso({ role: "VIEWER", ssoEnforced: true })).toBe(true);
    expect(requiresSso({ role: "OWNER", ssoEnforced: true })).toBe(false);
    expect(requiresSso({ role: "MEMBER", ssoEnforced: false })).toBe(false);
  });
});

describe("emailDomain", () => {
  it("lowercases the part after the last @", () => {
    expect(emailDomain("Ada@Acme.COM")).toBe("acme.com");
    expect(emailDomain('"odd@local"@acme.com')).toBe("acme.com");
  });

  it("returns null when there is no domain", () => {
    expect(emailDomain("nobody")).toBeNull();
    expect(emailDomain("trailing@")).toBeNull();
    expect(emailDomain("@acme.com")).toBeNull();
  });
});

describe("hasVerificationRecord", () => {
  const token = "abc123";

  it("matches the challenge record, rejoining chunked TXT values", async () => {
    const resolve = async (host: string) =>
      host === verificationRecordName("acme.com")
        ? [["v=spf1 -all"], ["resumerank-domain-", "verification=abc123"]]
        : [];
    expect(await hasVerificationRecord("acme.com", token, resolve)).toBe(true);
  });

  it("is false for another token or a failed lookup", async () => {
    expect(
      await hasVerificationRecord("acme.com", token, async () => [[verificationRecordValue("other")]]),
    ).toBe(false);
    expect(
      await hasVerificationRecord("acme.com", token, async () => {
        throw Object.assign(new Error("queryTxt ENOTFOUND"), { code: "ENOTFOUND" });
      }),
    ).toBe(false);
  });
});

describe("isPublicHttpsUrl", () => {
  const publicHost = async () => ["93.184.215.14"];

  it("accepts https on a public address", async () => {
    expect(await isPublicHttpsUrl("https://login.acme.com/.well-known/openid-configuration", publicHost)).toBe(true);
  });

  it("rejects plain http and embedded credentials", async () => {
    expect(await isPublicHttpsUrl("http://login.acme.com/", publicHost)).toBe(false);
    expect(await isPublicHttpsUrl("https://user:pass@login.acme.com/", publicHost)).toBe(false);
  });

  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.20.0.5",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:10.0.0.1",
  ])("rejects a host resolving to %s", async (address) => {
    expect(await isPublicHttpsUrl("https://idp.acme.com/", async () => [address])).toBe(false);
  });

  it("rejects if any answer is private, or the name doesn't resolve", async () => {
    expect(await isPublicHttpsUrl("https://idp.acme.com/", async () => ["93.184.215.14", "10.0.0.1"])).toBe(false);
    expect(await isPublicHttpsUrl("https://idp.acme.com/", async () => [])).toBe(false);
    expect(
      await isPublicHttpsUrl("https://idp.acme.com/", async () => {
        throw new Error("ENOTFOUND");
      }),
    ).toBe(false);
  });

  it("checks IP literals without a lookup", async () => {
    const neverCalled = async (): Promise<string[]> => {
      throw new Error("should not resolve");
    };
    expect(await isPublicHttpsUrl("https://[::1]/", neverCalled)).toBe(false);
    expect(await isPublicHttpsUrl("https://93.184.215.14/", neverCalled)).toBe(true);
  });
});

describe("SSO validators", () => {
  it("normalizes a pasted domain", () => {
    expect(addDomainSchema.parse({ domain: " @Acme.COM. " })).toEqual({ domain: "acme.com" });
  });

  it.each(["acme", "https://acme.com", "*.acme.com", "acme.com/path", "a..com", "localhost"])(
    "rejects %s as a domain",
    (domain) => {
      expect(addDomainSchema.safeParse({ domain }).success).toBe(false);
    },
  );

  it("requires https for an OIDC discovery URL", () => {
    const base = { type: "oidc", clientId: "id", clientSecret: "secret" } as const;
    expect(
      saveSsoConnectionSchema.safeParse({ ...base, discoveryUrl: "http://idp.acme.com/.well-known/openid-configuration" })
        .success,
    ).toBe(false);
    expect(
      saveSsoConnectionSchema.safeParse({ ...base, discoveryUrl: "https://idp.acme.com/.well-known/openid-configuration" })
        .success,
    ).toBe(true);
  });

  it("requires XML for SAML metadata", () => {
    expect(saveSsoConnectionSchema.safeParse({ type: "saml", metadataXml: "not xml" }).success).toBe(false);
    expect(saveSsoConnectionSchema.safeParse({ type: "saml", metadataXml: "<EntityDescriptor/>" }).success).toBe(true);
  });
});
