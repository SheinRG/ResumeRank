/**
 * Masks who a candidate is before their resume reaches the model, so a
 * verdict can't lean on a name, contact details or a protected attribute
 * (Company.aiRedactPii). Rule-based on purpose: it runs on every score, must
 * be predictable enough to explain to an auditor, and must never remove the
 * skills and experience being judged. Dates and year ranges are kept because
 * experience requirements depend on them.
 */

export interface RedactionSubject {
  name: string;
  email: string;
}

export const REDACTION_MARKERS = {
  name: "[NAME]",
  email: "[EMAIL]",
  phone: "[PHONE]",
  link: "[LINK]",
  age: "[AGE]",
  personal: "[REDACTED]",
} as const;

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/gu;
const LINK =
  /\b(?:https?:\/\/|www\.)[^\s<>()]+|\b(?:linkedin|github|gitlab|twitter|x|facebook|instagram|behance|dribbble)\.com\/[^\s<>()]+/giu;
// Stays on one line, and a bracketed area code only near the start, so a
// year range followed by "(5 years)" isn't read as one long number.
const PHONE_CANDIDATE = /\+?\d{0,3}[^\S\n]?(?:\(\d{1,4}\)[^\S\n]?)?\d(?:[\d.-]|[^\S\n]){6,}\d/g;
// A phone has 9–15 digits (E.164 caps at 15); fewer is a year range like "2018 - 2020".
const PHONE_DIGITS = { min: 9, max: 15 };
// Labelled lines common on CVs outside the US: the whole value goes. The
// label must end in a colon or a spaced dash, so a line starting
// "Race-condition debugging" stays.
const PERSONAL_LINE =
  /^([^\S\n]*(?:date of birth|birth ?date|d\.?o\.?b\.?|age|gender|sex|marital status|civil status|nationality|religion|race|ethnicity|pronouns|photo(?:graph)?|place of birth)(?:[^\S\n]*:|[^\S\n]+[–-])[^\S\n]*)\S.*$/gimu;
const AGE = /\b\d{1,2}[^\S\n]*(?:years?|yrs?)[^\S\n]*old\b|\baged[^\S\n]+\d{1,2}\b/giu;
// To the end of the sentence: a birthplace is usually "City, Country".
const BORN = /\bborn[^\S\n]+(?:in|on)[^\S\n]+[^\n.;]+/giu;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wholeWord(text: string, flags: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(text)}(?![\\p{L}\\p{N}])`, flags);
}

function redactName(text: string, name: string): string {
  const full = name.trim().replace(/\s+/g, " ");
  if (full.length === 0) return text;
  // The full name in any case, with any spacing between its parts.
  const parts = full.split(" ");
  const fullPattern = new RegExp(
    `(?<![\\p{L}\\p{N}])${parts.map(escapeRegExp).join("\\s+")}(?![\\p{L}\\p{N}])`,
    "giu",
  );
  let result = text.replace(fullPattern, REDACTION_MARKERS.name);
  // Each part alone only as written in the name (capitalised), so a first
  // name like "Will" doesn't take the verb "will" with it.
  for (const part of parts) {
    if (part.length < 2) continue;
    result = result.replace(wholeWord(part, "gu"), REDACTION_MARKERS.name);
  }
  return result;
}

function redactPhones(text: string): string {
  return text.replace(PHONE_CANDIDATE, (match) => {
    const digits = match.replace(/\D/g, "").length;
    return digits >= PHONE_DIGITS.min && digits <= PHONE_DIGITS.max ? REDACTION_MARKERS.phone : match;
  });
}

export function redactResume(text: string, subject: RedactionSubject): string {
  let result = text;
  if (subject.email.trim()) {
    result = result.replace(wholeWord(subject.email.trim(), "giu"), REDACTION_MARKERS.email);
  }
  result = result.replace(EMAIL, REDACTION_MARKERS.email);
  result = result.replace(LINK, REDACTION_MARKERS.link);
  result = result.replace(PERSONAL_LINE, `$1${REDACTION_MARKERS.personal}`);
  result = result.replace(BORN, `born ${REDACTION_MARKERS.personal}`);
  result = result.replace(AGE, REDACTION_MARKERS.age);
  result = redactPhones(result);
  return redactName(result, subject.name);
}

/** The resume text the model is given under the company's policy. */
export function resumeForScoring(resumeText: string, subject: RedactionSubject, redact: boolean): string {
  return redact ? redactResume(resumeText, subject) : resumeText;
}
