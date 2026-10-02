import { describe, expect, it } from "vitest";
import { escapeHtml, singleLine } from "../../src/html";

describe("escapeHtml", () => {
  it("escapes markup so a company name can't inject HTML", () => {
    expect(escapeHtml(`<a href="https://evil">Click</a>`)).toBe(
      "&lt;a href=&quot;https://evil&quot;&gt;Click&lt;/a&gt;",
    );
  });

  it("escapes ampersands and single quotes", () => {
    expect(escapeHtml("Tom & Jerry's")).toBe("Tom &amp; Jerry&#39;s");
  });

  it("leaves plain text untouched", () => {
    expect(escapeHtml("Acme Corp")).toBe("Acme Corp");
  });
});

describe("singleLine", () => {
  it("collapses CR/LF so a value can't add mail headers", () => {
    expect(singleLine("Acme\r\nBcc: victim@example.com")).toBe(
      "Acme Bcc: victim@example.com",
    );
  });
});
