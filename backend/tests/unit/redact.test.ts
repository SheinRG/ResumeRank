import { describe, expect, it } from "vitest";

import { redactResume, resumeForScoring } from "../../src/scoring/redact";

const subject = { name: "Maria José Alvarez", email: "maria.alvarez@example.com" };

describe("redactResume", () => {
  it("masks the candidate's name, alone and in full, in any case", () => {
    const text = "MARIA JOSÉ ALVAREZ\nSenior engineer. Alvarez led the payments team; Maria José mentored four engineers.";
    const redacted = redactResume(text, subject);
    expect(redacted).not.toMatch(/maria|alvarez|josé/i);
    expect(redacted).toContain("[NAME] led the payments team");
  });

  it("keeps ordinary words that only look like a name part", () => {
    const redacted = redactResume("Will Turner\nI will migrate the billing service.", {
      name: "Will Turner",
      email: "",
    });
    expect(redacted).toBe("[NAME]\nI will migrate the billing service.");
  });

  it("masks contact details and profile links", () => {
    const text =
      "maria.alvarez@example.com · +1 (415) 555-0134 · linkedin.com/in/maria-alvarez · https://maria.dev/portfolio · other@corp.io";
    const redacted = redactResume(text, subject);
    expect(redacted).toBe("[EMAIL] · [PHONE] · [LINK] · [LINK] · [EMAIL]");
  });

  it("keeps year ranges and durations that experience requirements depend on", () => {
    const text = "Acme Corp, 2018 - 2023 (5 years)\nPython since 2012, 10+ years of backend work.";
    expect(redactResume(text, subject)).toBe(text);
  });

  it("masks labelled personal attributes and stated ages", () => {
    const text = [
      "Date of birth: 14 March 1988",
      "Nationality: Spanish",
      "Marital status - married",
      "Gender: Female",
      "Skills: Go, Kubernetes",
      "I am 36 years old and was born in Seville, Spain.",
    ].join("\n");
    expect(redactResume(text, subject)).toBe(
      [
        "Date of birth: [REDACTED]",
        "Nationality: [REDACTED]",
        "Marital status - [REDACTED]",
        "Gender: [REDACTED]",
        "Skills: Go, Kubernetes",
        "I am [AGE] and was born [REDACTED].",
      ].join("\n"),
    );
  });

  it("doesn't touch requirement-like wording", () => {
    const text = "Race-condition debugging in Go\nAgile delivery; ran an aged-care services migration.\nAge-old systems: COBOL.";
    expect(redactResume(text, { name: "Sam Lee", email: "" })).toBe(text);
  });
});

describe("resumeForScoring", () => {
  it("passes the text through untouched when the policy is off", () => {
    expect(resumeForScoring("Maria José Alvarez", subject, false)).toBe("Maria José Alvarez");
  });
});
