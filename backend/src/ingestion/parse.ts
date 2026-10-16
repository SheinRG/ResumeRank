/// <reference path="../types/tesseract-data.d.ts" />

import engData from "@tesseract.js-data/eng";
import mammoth from "mammoth";
import { createWorker, OEM } from "tesseract.js";
import { extractText, getDocumentProxy, renderPageAsImage } from "unpdf";

import type { ResumeExtraction, ResumeFileKind } from "../generated/prisma/enums";
import { DomainError } from "../services/errors";
import { MIN_RESUME_LENGTH } from "../validators/candidate";
import { cleanExtractedText } from "./text";

/** OCR reads a page in a few seconds; a resume's first pages are the ones that matter. */
export const MAX_OCR_PAGES = 4;
/** Twice PDF resolution (144 dpi) is where small resume type becomes legible to OCR. */
const OCR_SCALE = 2;

export interface ParsedResume {
  text: string;
  extraction: ResumeExtraction;
}

export type ResumeParser = (kind: ResumeFileKind, bytes: Uint8Array) => Promise<ParsedResume>;

/** The file itself is the problem, so retrying can't help; the message is shown to the uploader. */
export class UnreadableResumeError extends DomainError {}

const UNREADABLE = "We couldn't read this file. Check that it opens, or paste the resume text instead.";
const ENCRYPTED = "This PDF is password-protected. Upload a copy without a password, or paste the resume text instead.";
const TOO_LITTLE_TEXT = `We found fewer than ${MIN_RESUME_LENGTH} characters of text in this file, too little to score. Paste the resume text instead.`;

type PdfDocument = Awaited<ReturnType<typeof getDocumentProxy>>;

async function openPdf(bytes: Uint8Array): Promise<PdfDocument> {
  try {
    // pdf.js may transfer the buffer it's given; the caller's copy must survive.
    return await getDocumentProxy(new Uint8Array(bytes));
  } catch (error) {
    if (error instanceof Error && error.name === "PasswordException") throw new UnreadableResumeError(ENCRYPTED);
    throw new UnreadableResumeError(UNREADABLE);
  }
}

async function ocrPdf(pdf: PdfDocument): Promise<string> {
  const worker = await createWorker("eng", OEM.LSTM_ONLY, {
    langPath: engData.langPath,
    gzip: engData.gzip,
    cacheMethod: "none",
  });
  try {
    const pages: string[] = [];
    for (let page = 1; page <= Math.min(pdf.numPages, MAX_OCR_PAGES); page++) {
      const image = await renderPageAsImage(pdf, page, {
        canvasImport: () => import("@napi-rs/canvas"),
        scale: OCR_SCALE,
      });
      const { data } = await worker.recognize(Buffer.from(image));
      pages.push(data.text);
    }
    return pages.join("\n\n");
  } finally {
    await worker.terminate();
  }
}

/**
 * A PDF's own text layer when it has one; a scanned PDF (no text, or too
 * little to score) falls back to OCR of its first pages.
 */
async function parsePdf(bytes: Uint8Array): Promise<ParsedResume> {
  const pdf = await openPdf(bytes);
  try {
    const { text } = await extractText(pdf, { mergePages: true });
    const layer = cleanExtractedText(text);
    if (layer.length >= MIN_RESUME_LENGTH) return { text: layer, extraction: "TEXT" };
    return { text: cleanExtractedText(await ocrPdf(pdf)), extraction: "OCR" };
  } finally {
    await pdf.loadingTask.destroy();
  }
}

async function parseDocx(bytes: Uint8Array): Promise<ParsedResume> {
  try {
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return { text: cleanExtractedText(value), extraction: "TEXT" };
  } catch {
    throw new UnreadableResumeError(UNREADABLE);
  }
}

export const parseResumeFile: ResumeParser = async (kind, bytes) => {
  const parsed = kind === "PDF" ? await parsePdf(bytes) : await parseDocx(bytes);
  if (parsed.text.length < MIN_RESUME_LENGTH) throw new UnreadableResumeError(TOO_LITTLE_TEXT);
  return parsed;
};
