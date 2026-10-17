import { crc32 } from "node:zlib";

import { createCanvas } from "@napi-rs/canvas";

/** Builds the small PDF and DOCX files the ingestion tests parse. */

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;

function escapePdfText(line: string): string {
  return line.replace(/[\\()]/g, (c) => `\\${c}`);
}

/** Assembles objects into a PDF with a correct cross-reference table. */
function assemblePdf(objects: Buffer[]): Uint8Array {
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n")];
  const offsets: number[] = [];
  let length = parts[0].length;
  objects.forEach((body, i) => {
    offsets.push(length);
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), body, Buffer.from("\nendobj\n")]);
    parts.push(chunk);
    length += chunk.length;
  });
  const xref = [
    "xref",
    `0 ${objects.length + 1}`,
    "0000000000 65535 f ",
    ...offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n `),
    "trailer",
    `<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    "startxref",
    String(length),
    "%%EOF",
  ].join("\n");
  parts.push(Buffer.from(`${xref}\n`));
  return new Uint8Array(Buffer.concat(parts));
}

function stream(dictionary: string, data: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`<< ${dictionary} /Length ${data.length} >>\nstream\n`),
    data,
    Buffer.from("\nendstream"),
  ]);
}

/** A one-page PDF whose lines are real text, as an exported document has. */
export function textPdf(lines: string[]): Uint8Array {
  const content = [
    "BT",
    "/F1 11 Tf",
    "14 TL",
    "50 740 Td",
    ...lines.map((line) => `(${escapePdfText(line)}) Tj T*`),
    "ET",
  ].join("\n");
  return assemblePdf([
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`,
    ),
    stream("", Buffer.from(content)),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
  ]);
}

/** A one-page PDF that is only a picture of the lines, as a scanner produces. */
export function scannedPdf(lines: string[]): Uint8Array {
  const scale = 2;
  const canvas = createCanvas(PAGE_WIDTH * scale, PAGE_HEIGHT * scale);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#000000";
  context.font = `${14 * scale}px sans-serif`;
  lines.forEach((line, i) => context.fillText(line, 50 * scale, (60 + i * 22) * scale));
  const jpeg = canvas.toBuffer("image/jpeg", 95);

  return assemblePdf([
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Contents 4 0 R /Resources << /XObject << /Im1 5 0 R >> >> >>`,
    ),
    stream("", Buffer.from(`q ${PAGE_WIDTH} 0 0 ${PAGE_HEIGHT} 0 0 cm /Im1 Do Q`)),
    stream(
      `/Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`,
      jpeg,
    ),
  ]);
}

/** An uncompressed (stored) zip: enough for a reader, and no zip library needed. */
function storedZip(files: Record<string, string>): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = Buffer.from(name);
    const data = Buffer.from(text);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    const entry = Buffer.concat([local, nameBytes, data]);
    locals.push(entry);
    centrals.push(Buffer.concat([central, nameBytes]));
    offset += entry.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length, 8);
  end.writeUInt16LE(centrals.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

function escapeXml(text: string): string {
  return text.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] ?? c);
}

export function docx(paragraphs: string[]): Uint8Array {
  const body = paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(p)}</w:t></w:r></w:p>`).join("");
  return storedZip({
    "[Content_Types].xml":
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels":
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  });
}

export const RESUME_LINES = [
  "Jordan Rivera - Senior Backend Engineer",
  "Seven years building payment and data platforms in TypeScript and Go.",
  "Led the migration of a billing service to Postgres with zero downtime.",
  "Designed event pipelines on Kafka processing two million events a day.",
  "Mentored four engineers and ran the on-call rotation for the platform team.",
  "Education: BSc Computer Science, University of Toronto.",
];
