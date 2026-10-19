import { describe, expect, it } from "vitest";

import { isTimeZone, listTimeZones, resolveFormatPrefs } from "../../src/locale";
import { personalFormatSchema, workspaceFormatSchema } from "../../src/validators/locale";

describe("isTimeZone", () => {
  it("accepts IANA zones and refuses anything else", () => {
    expect(isTimeZone("Asia/Kolkata")).toBe(true);
    expect(isTimeZone("UTC")).toBe(true);
    expect(isTimeZone("America/New_York")).toBe(true);
    expect(isTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isTimeZone("")).toBe(false);
  });
});

describe("listTimeZones", () => {
  it("puts UTC first and lists it once", () => {
    const zones = listTimeZones();
    expect(zones[0]).toBe("UTC");
    expect(zones.filter((zone) => zone === "UTC")).toHaveLength(1);
    expect(zones).toContain("Europe/Berlin");
  });
});

describe("resolveFormatPrefs", () => {
  const workspace = { locale: "en-GB", timeZone: "Europe/London" };

  it("prefers the person's choice, then the workspace's", () => {
    expect(resolveFormatPrefs({ locale: "de-DE", timeZone: "Asia/Kolkata" }, workspace)).toEqual({
      locale: "de-DE",
      timeZone: "Asia/Kolkata",
    });
    expect(resolveFormatPrefs({ locale: null, timeZone: null }, workspace)).toEqual(workspace);
    expect(resolveFormatPrefs({ locale: null, timeZone: "Asia/Tokyo" }, workspace)).toEqual({
      locale: "en-GB",
      timeZone: "Asia/Tokyo",
    });
  });

  it("falls back to the defaults without a workspace", () => {
    expect(resolveFormatPrefs({ locale: null, timeZone: null }, null)).toEqual({ locale: "en-US", timeZone: "UTC" });
  });

  it("skips stored values the runtime doesn't know instead of throwing later", () => {
    expect(resolveFormatPrefs({ locale: "xx-YY", timeZone: "Gone/Zone" }, workspace)).toEqual(workspace);
  });
});

describe("format schemas", () => {
  it("lets a person follow the workspace with null, but not the workspace itself", () => {
    expect(personalFormatSchema.safeParse({ locale: null, timeZone: null }).success).toBe(true);
    expect(workspaceFormatSchema.safeParse({ locale: null, timeZone: "UTC" }).success).toBe(false);
    expect(workspaceFormatSchema.safeParse({ locale: "fr-FR", timeZone: "Europe/Paris" }).success).toBe(true);
    expect(personalFormatSchema.safeParse({ locale: "en-US", timeZone: "Nowhere/Land" }).success).toBe(false);
    expect(personalFormatSchema.safeParse({ locale: "tlh-KL", timeZone: null }).success).toBe(false);
  });
});
