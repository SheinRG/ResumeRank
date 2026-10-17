import type { ResumeFileKind } from "../generated/prisma/enums";

const PDF_MAGIC = "%PDF-";
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
/** A zip's member names are stored uncompressed, so a Word document shows this path in its bytes. */
const DOCX_MEMBER = "word/document.xml";

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((byte, i) => bytes[i] === byte);
}

/**
 * The file's type, read from its bytes. The browser's MIME type and the file
 * name are the uploader's claims, so neither decides how a file is parsed.
 */
export function sniffResumeKind(bytes: Uint8Array): ResumeFileKind | null {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  // PDF readers accept the header anywhere in the first kilobyte.
  if (head.includes(PDF_MAGIC)) return "PDF";
  if (startsWith(bytes, ZIP_MAGIC) && Buffer.from(bytes).includes(DOCX_MEMBER, 0, "latin1")) {
    return "DOCX";
  }
  return null;
}
