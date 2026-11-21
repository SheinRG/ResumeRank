import { renderPageAsImage, type getDocumentProxy } from "unpdf";

import { errorFields, log } from "../observability/log";

type PdfDocument = Awaited<ReturnType<typeof getDocumentProxy>>;
type PdfPage = Awaited<ReturnType<PdfDocument["getPage"]>>;
type PdfViewport = ReturnType<PdfPage["getViewport"]>;
type ContentItem = Awaited<ReturnType<PdfPage["getTextContent"]>>["items"][number];
type TextItem = Extract<ContentItem, { str: string }>;

/** A hidden keyword block sits on a resume's first pages; later pages are kept unchecked. */
export const MAX_VISIBILITY_PAGES = 6;
const RENDER_SCALE = 2;
/**
 * The widest colour spread a text box can have and still look blank. Light
 * gray text on white spreads far wider; white or near-white text doesn't.
 */
const MIN_INK_CONTRAST = 24;
/** Text set smaller than this many points can't be read, whatever its colour. */
const MIN_READABLE_FONT_SIZE = 2;
// The band of a line every letter or digit puts ink in, as fractions of the
// font size above the baseline; neighbouring lines stay out of it.
const GLYPH_BAND_BOTTOM = 0.1;
const GLYPH_BAND_TOP = 0.6;

export interface PdfTextLayer {
  /** The text a reader of the rendered page can see. */
  text: string;
  /** Text in the layer that renders as nothing a reader can see. */
  hiddenText: string;
}

interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

async function renderPixels(pdf: PdfDocument, pageNumber: number): Promise<Pixels> {
  const canvasModule = await import("@napi-rs/canvas");
  const png = await renderPageAsImage(pdf, pageNumber, {
    canvasImport: () => import("@napi-rs/canvas"),
    scale: RENDER_SCALE,
  });
  const image = await canvasModule.loadImage(Buffer.from(png));
  const canvas = canvasModule.createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  return { data: context.getImageData(0, 0, image.width, image.height).data, width: image.width, height: image.height };
}

/** Punctuation and spaces carry no claim, so they're never judged or dropped. */
function isJudged(item: TextItem): boolean {
  return /[\p{L}\p{N}]/u.test(item.str);
}

/** The pixel box where the item's letters must leave ink, or null when it lies off the page. */
function glyphBox(item: TextItem, viewport: PdfViewport, pixels: Pixels): [number, number, number, number] | null {
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = item.transform.map(Number);
  const size = Math.hypot(c, d);
  const run = Math.hypot(a, b);
  if (size === 0 || run === 0 || item.width <= 0) return null;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const along of [0, item.width]) {
    for (const up of [GLYPH_BAND_BOTTOM * size, GLYPH_BAND_TOP * size]) {
      const [x = 0, y = 0] = viewport.convertToViewportPoint(
        e + (along * a) / run + (up * c) / size,
        f + (along * b) / run + (up * d) / size,
      );
      xs.push(x);
      ys.push(y);
    }
  }
  const left = Math.max(0, Math.floor(Math.min(...xs)));
  const right = Math.min(pixels.width, Math.ceil(Math.max(...xs)));
  const top = Math.max(0, Math.floor(Math.min(...ys)));
  const bottom = Math.min(pixels.height, Math.ceil(Math.max(...ys)));
  return right > left && bottom > top ? [left, top, right, bottom] : null;
}

/** Whether any colour channel varies across the box enough to show a glyph. */
function hasInk(pixels: Pixels, [left, top, right, bottom]: [number, number, number, number]): boolean {
  const low = [255, 255, 255];
  const high = [0, 0, 0];
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const offset = (y * pixels.width + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        const value = pixels.data[offset + channel];
        if (value < low[channel]) low[channel] = value;
        if (value > high[channel]) high[channel] = value;
        if (high[channel] - low[channel] >= MIN_INK_CONTRAST) return true;
      }
    }
  }
  return false;
}

function isVisible(item: TextItem, viewport: PdfViewport, pixels: Pixels): boolean {
  const [, , c = 0, d = 0] = item.transform.map(Number);
  if (Math.hypot(c, d) < MIN_READABLE_FONT_SIZE) return false;
  const box = glyphBox(item, viewport, pixels);
  return box !== null && hasInk(pixels, box);
}

interface PageText {
  items: TextItem[];
  /** Per item: false when it renders as nothing a reader sees; null when the page wasn't checked. */
  visible: Array<boolean | null>;
}

async function readPage(pdf: PdfDocument, pageNumber: number): Promise<PageText> {
  const page = await pdf.getPage(pageNumber);
  const content = await page.getTextContent();
  const items = content.items.filter((item): item is TextItem => "str" in item);
  if (pageNumber > MAX_VISIBILITY_PAGES || !items.some(isJudged)) {
    return { items, visible: items.map(() => null) };
  }
  try {
    const pixels = await renderPixels(pdf, pageNumber);
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    return { items, visible: items.map((item) => (isJudged(item) ? isVisible(item, viewport, pixels) : null)) };
  } catch (error) {
    log.warn("resume_file.page_unchecked", { pageNumber, ...errorFields(error) });
    return { items, visible: items.map(() => null) };
  }
}

/** Joined the way unpdf joins a text layer: line ends where the PDF marks them, pages on new lines. */
function joinPages(pages: PageText[], keepHidden: boolean): string {
  return pages
    .map(({ items, visible }) =>
      items
        .map((item, i) => (keepHidden || visible[i] !== false ? item.str : "") + (item.hasEOL ? "\n" : ""))
        .join(""),
    )
    .join("\n");
}

/**
 * The PDF's text layer split into what a reader sees and what they can't:
 * each page is rendered and every piece of text that leaves no ink where its
 * letters belong (white or background-coloured text, text under a shape,
 * clipped away, off the page or too small to read) is set aside, so scoring
 * reads the resume a recruiter would. When nothing on any page appears to
 * render, the renderer is what failed, so the whole layer is kept.
 */
export async function readPdfText(pdf: PdfDocument): Promise<PdfTextLayer> {
  const pages: PageText[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    pages.push(await readPage(pdf, pageNumber));
  }
  const judged = pages.flatMap((page) => page.visible.filter((v): v is boolean => v !== null));
  if (judged.length > 0 && !judged.includes(true)) {
    log.warn("resume_file.visibility_unchecked", { judgedItems: judged.length });
    return { text: joinPages(pages, true), hiddenText: "" };
  }
  const hidden = pages.flatMap(({ items, visible }) => items.filter((_, i) => visible[i] === false));
  return { text: joinPages(pages, false), hiddenText: hidden.map((item) => item.str).join(" ") };
}
