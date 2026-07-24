import { describe, expect, it } from "vitest";
import {
  extractJson,
  parseProfile,
  ExtractionError,
} from "../../src/extraction/parse";

const resume =
  "Jane Doe\njane.doe@example.com\nSenior Backend Engineer with 8 years building Python and Go services.";

describe("extractJson", () => {
  it("parses a clean JSON object", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("recovers JSON wrapped in prose or fences", () => {
    expect(extractJson('Here you go:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("throws a ExtractionError when no object is present", () => {
    expect(() => extractJson("no json here")).toThrow(ExtractionError);
  });

  it("throws a ExtractionError on malformed JSON", () => {
    expect(() => extractJson('{"a":')).toThrow(ExtractionError);
  });
});

describe("parseProfile", () => {
  it("keeps an email that appears verbatim in the resume", () => {
    const profile = parseProfile(
      {
        name: "Jane Doe",
        email: "jane.doe@example.com",
        headline: "Senior Backend Engineer",
      },
      resume,
    );
    expect(profile.email).toBe("jane.doe@example.com");
  });

  it("drops an email that does not appear in the resume", () => {
    const profile = parseProfile(
      { name: "Jane Doe", email: "someone.else@evil.com", headline: null },
      resume,
    );
    expect(profile.email).toBeNull();
  });

  it("coerces empty and whitespace-only strings to null", () => {
    const profile = parseProfile(
      { name: "", email: "", headline: "   " },
      resume,
    );
    expect(profile).toEqual({ name: null, email: null, headline: null });
  });

  it("trims field values", () => {
    const profile = parseProfile(
      { name: "  Jane Doe  ", email: null, headline: null },
      resume,
    );
    expect(profile.name).toBe("Jane Doe");
  });

  it("rejects output missing required keys", () => {
    expect(() => parseProfile({ name: "Jane" }, resume)).toThrow();
  });
});
