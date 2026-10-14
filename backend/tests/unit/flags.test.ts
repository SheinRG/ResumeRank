import { describe, expect, it } from "vitest";

import { FEATURE_FLAGS, FLAGS, isFeatureFlag, type FlagDefinition } from "../../src/flags/registry";
import { decideFlag, featureSet, rolloutBucket } from "../../src/flags/resolve";
import { flagOverrideSchema } from "../../src/validators/feature-flag";

const release = (rolloutPercent: number): FlagDefinition => ({
  kind: "release",
  label: "Test release",
  description: "A flag for tests.",
  defaultEnabled: false,
  rolloutPercent,
});

const companies = Array.from({ length: 2000 }, (_, index) => `company-${index}`);

describe("feature flag resolution", () => {
  it("lets an override beat the rollout and the default", () => {
    expect(decideFlag("sso", "c1", false)).toEqual({ enabled: false, source: "override" });
    expect(decideFlag("sso", "c1", true, release(0))).toEqual({ enabled: true, source: "override" });
    expect(decideFlag("sso", "c1", false, release(100))).toEqual({ enabled: false, source: "override" });
  });

  it("falls back to the default without an override or rollout", () => {
    expect(decideFlag("sso", "c1", undefined)).toEqual({ enabled: FLAGS.sso.defaultEnabled, source: "default" });
    expect(decideFlag("sso", "c1", undefined, release(0))).toEqual({ enabled: false, source: "default" });
  });

  it("rolls out to everyone at 100% and no one at 0%", () => {
    expect(companies.every((id) => decideFlag("sso", id, undefined, release(100)).source === "rollout")).toBe(true);
    expect(companies.some((id) => decideFlag("sso", id, undefined, release(0)).enabled)).toBe(false);
  });

  it("gives each company a stable bucket, so raising the percentage only adds companies", () => {
    const at = (percent: number) =>
      new Set(companies.filter((id) => decideFlag("sso", id, undefined, release(percent)).enabled));
    const ten = at(10);
    const fifty = at(50);
    expect([...ten].every((id) => fifty.has(id))).toBe(true);
    expect(rolloutBucket("sso", "company-1")).toBe(rolloutBucket("sso", "company-1"));
  });

  it("spreads companies roughly evenly across buckets", () => {
    const share = companies.filter((id) => rolloutBucket("sso", id) < 25).length / companies.length;
    expect(share).toBeGreaterThan(0.2);
    expect(share).toBeLessThan(0.3);
  });

  it("puts a company at a different place in each flag's rollout", () => {
    const differ = companies.filter((id) => rolloutBucket("sso", id) !== rolloutBucket("audit-streaming", id));
    expect(differ.length).toBeGreaterThan(companies.length * 0.9);
  });

  it("decides every known flag and ignores rows for removed ones", () => {
    const set = featureSet("c1", [
      { flag: "audit-streaming", enabled: false },
      { flag: "retired-flag", enabled: true },
    ]);
    expect(Object.keys(set).sort()).toEqual([...FEATURE_FLAGS].sort());
    expect(set["audit-streaming"]).toBe(false);
    expect(set.sso).toBe(true);
    expect(isFeatureFlag("retired-flag")).toBe(false);
    expect(isFeatureFlag("toString")).toBe(false);
  });

  it("keeps every existing feature on by default, so the flags change nothing until one is set", () => {
    const entitlements = FEATURE_FLAGS.filter((flag) => FLAGS[flag].kind === "entitlement");
    expect(entitlements.every((flag) => FLAGS[flag].defaultEnabled)).toBe(true);
  });
});

describe("flag override input", () => {
  it("accepts a known flag and a clear", () => {
    expect(flagOverrideSchema.parse({ companySlug: " acme ", flag: "sso", enabled: null })).toEqual({
      companySlug: "acme",
      flag: "sso",
      enabled: null,
    });
  });

  it("rejects an unknown flag", () => {
    const result = flagOverrideSchema.safeParse({ companySlug: "acme", flag: "nope", enabled: true });
    expect(result.success).toBe(false);
  });
});
