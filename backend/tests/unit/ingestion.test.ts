import { describe, expect, it } from "vitest";

import { parseResumeFile, UnreadableResumeError } from "../../src/ingestion/parse";
import { sniffResumeKind } from "../../src/ingestion/sniff";
import { cleanExtractedText } from "../../src/ingestion/text";
import { MAX_RESUME_LENGTH } from "../../src/validators/candidate";
import { resumeFileUploadSchema, RESUME_FILE_MAX_BYTES, RESUME_FILE_TYPES } from "../../src/validators/resume-file";
import { docx, RESUME_LINES, scannedPdf, textPdf } from "../resume-files";

describe("sniffResumeKind", () => {
  it("recognizes PDFs and Word documents by their bytes", () => {
    expect(sniffResumeKind(textPdf(["hello"]))).toBe("PDF");
    expect(sniffResumeKind(docx(["hello"]))).toBe("DOCX");
  });

  it("refuses anything else, whatever it claims to be", () => {
    expect(sniffResumeKind(new TextEncoder().encode("<html><script>alert(1)</script>"))).toBeNull();
    // A zip that isn't a Word document (e.g. a renamed archive).
    const zip = docx(["x"]);
    const notWord = Buffer.from(zip).toString("latin1").replaceAll("word/document.xml", "data/payload.xml");
    expect(sniffResumeKind(new Uint8Array(Buffer.from(notWord, "latin1")))).toBeNull();
  });
});

describe("cleanExtractedText", () => {
  it("drops control characters Postgres would reject and collapses layout noise", () => {
    expect(cleanExtractedText("Jordan\u0000 Rivera\r\n\r\n\r\n\r\nGo   and\tTypeScript  \n")).toBe(
      "Jordan Rivera\n\nGo and TypeScript",
    );
  });

  it("folds PDF ligatures and caps the length at the resume limit", () => {
    expect(cleanExtractedText("ﬁnance oﬃce")).toBe("finance office");
    expect(cleanExtractedText("a".repeat(MAX_RESUME_LENGTH + 500))).toHaveLength(MAX_RESUME_LENGTH);
  });

  it("keeps invisible characters so scoring can still flag hidden text", () => {
    expect(cleanExtractedText("visible​hidden")).toBe("visible​hidden");
  });
});

describe("parseResumeFile", () => {
  it("reads a PDF's text layer", async () => {
    const parsed = await parseResumeFile("PDF", textPdf(RESUME_LINES));
    expect(parsed.extraction).toBe("TEXT");
    expect(parsed.text).toContain("Senior Backend Engineer");
    expect(parsed.text).toContain("two million events a day");
  });

  it("reads a Word document", async () => {
    const parsed = await parseResumeFile("DOCX", docx(RESUME_LINES));
    expect(parsed).toMatchObject({ extraction: "TEXT" });
    expect(parsed.text).toContain("Mentored four engineers");
  });

  it("falls back to OCR for a scanned PDF", async () => {
    const parsed = await parseResumeFile("PDF", scannedPdf(RESUME_LINES));
    expect(parsed.extraction).toBe("OCR");
    expect(parsed.text).toMatch(/Backend Engineer/i);
    expect(parsed.text).toMatch(/Postgres/i);
  }, 90_000);

  it("fails with a user-safe reason for a broken file or one with too little text", async () => {
    await expect(parseResumeFile("PDF", new TextEncoder().encode("%PDF-1.4 garbage"))).rejects.toThrow(
      UnreadableResumeError,
    );
    await expect(parseResumeFile("DOCX", docx(["Too short."]))).rejects.toThrow(/fewer than/);
  });
});

describe("resumeFileUploadSchema", () => {
  const file = (bytes: number, type: string) => new File([new Uint8Array(bytes)], "resume", { type });

  it("accepts a PDF or Word file up to the size limit", () => {
    expect(resumeFileUploadSchema.safeParse({ candidateId: "c1", file: file(10, RESUME_FILE_TYPES.PDF.mime) }).success).toBe(true);
    expect(resumeFileUploadSchema.safeParse({ candidateId: "c1", file: file(10, RESUME_FILE_TYPES.DOCX.mime) }).success).toBe(true);
  });

  it("rejects empty, oversized and other files", () => {
    for (const bad of [file(0, RESUME_FILE_TYPES.PDF.mime), file(RESUME_FILE_MAX_BYTES + 1, RESUME_FILE_TYPES.PDF.mime), file(10, "image/png")]) {
      expect(resumeFileUploadSchema.safeParse({ candidateId: "c1", file: bad }).success).toBe(false);
    }
  });
});
