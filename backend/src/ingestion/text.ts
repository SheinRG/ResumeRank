import { MAX_RESUME_LENGTH } from "../validators/candidate";

// C0 controls except tab and newline (and DEL): Postgres rejects NUL in text,
// and the rest only come from broken extraction.
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

/**
 * Normalizes text pulled out of an uploaded file. It is still untrusted: it
 * reaches the model only inside an untrusted block, like typed resume text.
 * Invisible characters are kept, because scoring flags text hidden with them.
 */
export function cleanExtractedText(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_RESUME_LENGTH)
    .trim();
}
