import { getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";

import { parseResumeFile } from "../../src/ingestion/parse";
import { readPdfText } from "../../src/ingestion/pdf-text";
import { drawnPdf, filledRect, RESUME_LINES, textRun, type TextRun } from "../resume-files";

const WHITE: [number, number, number] = [1, 1, 1];
const STUFFING = "Kubernetes Terraform Kafka Rust";

/** The sample resume as visible black lines, plus whatever else the test draws. */
function resumeWith(extra: string[]): Uint8Array {
  const lines = RESUME_LINES.map((text, i): TextRun => ({ text, y: 740 - i * 16 }));
  return drawnPdf([...lines.map(textRun), ...extra]);
}

async function layerOf(bytes: Uint8Array) {
  const pdf = await getDocumentProxy(bytes);
  try {
    return await readPdfText(pdf);
  } finally {
    await pdf.loadingTask.destroy();
  }
}

describe("readPdfText", () => {
  it("keeps an ordinary resume whole", async () => {
    const layer = await layerOf(resumeWith([]));
    expect(layer.hiddenText).toBe("");
    for (const line of RESUME_LINES) expect(layer.text).toContain(line);
  });

  it("sets aside white text on a white page", async () => {
    const layer = await layerOf(resumeWith([textRun({ text: STUFFING, y: 500, rgb: WHITE })]));
    expect(layer.hiddenText).toBe(STUFFING);
    expect(layer.text).not.toContain("Kubernetes");
    expect(layer.text).toContain("Senior Backend Engineer");
  });

  it("sets aside text drawn with the invisible rendering mode", async () => {
    const layer = await layerOf(resumeWith([textRun({ text: STUFFING, y: 500, mode: 3 })]));
    expect(layer.hiddenText).toBe(STUFFING);
  });

  it("sets aside text covered by a shape painted over it", async () => {
    const layer = await layerOf(
      resumeWith([textRun({ text: STUFFING, y: 500 }), filledRect(40, 490, 400, 30, WHITE)]),
    );
    expect(layer.hiddenText).toBe(STUFFING);
  });

  it("sets aside text too small to read", async () => {
    const layer = await layerOf(resumeWith([textRun({ text: "Kubernetes expert", y: 500, size: 1 })]));
    expect(layer.hiddenText).toBe("Kubernetes expert");
    expect(layer.text).not.toContain("Kubernetes");
  });

  it("never reads text placed off the page", async () => {
    const layer = await layerOf(resumeWith([textRun({ text: "Terraform expert", x: 900, y: 500 })]));
    expect(layer.text).not.toContain("Terraform");
  });

  it("keeps light text on a dark panel and faint gray text, which a reader can see", async () => {
    const layer = await layerOf(
      resumeWith([
        filledRect(40, 380, 300, 40, [0.1, 0.12, 0.2]),
        textRun({ text: "Certified Kubernetes Administrator", y: 395, rgb: WHITE }),
        textRun({ text: "References available on request", y: 300, rgb: [0.6, 0.6, 0.6] }),
      ]),
    );
    expect(layer.hiddenText).toBe("");
    expect(layer.text).toContain("Certified Kubernetes Administrator");
    expect(layer.text).toContain("References available on request");
  });

  it("keeps the whole layer when nothing on the page renders, since that means the renderer failed", async () => {
    const lines = RESUME_LINES.map((text, i) => textRun({ text, y: 740 - i * 16, rgb: WHITE }));
    const layer = await layerOf(drawnPdf(lines));
    expect(layer.hiddenText).toBe("");
    expect(layer.text).toContain("Senior Backend Engineer");
  });
});

describe("parseResumeFile with hidden text", () => {
  it("scores only the visible text and reports what it left out", async () => {
    const parsed = await parseResumeFile("PDF", resumeWith([textRun({ text: STUFFING, y: 500, rgb: [0.98, 0.98, 0.98] })]));
    expect(parsed.extraction).toBe("TEXT");
    expect(parsed.text).not.toContain("Kubernetes");
    expect(parsed.text).toContain("two million events a day");
    expect(parsed.hiddenText).toBe(STUFFING);
  });
});
