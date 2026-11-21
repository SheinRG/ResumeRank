/**
 * The form quotes are matched in: NFKC folds ligatures and full-width forms,
 * then only letters and digits survive, so line breaks, hyphenation across a
 * break, bullets, and curly-vs-straight punctuation from PDF extraction can't
 * fail a quote that is really there. Words still have to appear in order.
 */
export function canonicalForMatch(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

const LIST_HEADING =
  /^(?:(?:core|key|technical|tech|professional|relevant|other|additional|hard|soft|top)\s+)?(?:skills?(?:\s*(?:&|and)\s*(?:tools|technologies|expertise|abilities))?|competenc(?:y|ies)|technologies|tech(?:nology|nical)?\s+stack|stack|tools?(?:\s*(?:&|and)\s*technologies)?|keywords|expertise|areas\s+of\s+expertise|proficienc(?:y|ies))$/i;

/** Headings that end a skills section; anything else short and list-like continues it. */
const SECTION_HEADING =
  /^(?:(?:work|professional|relevant|other|selected|personal|academic)\s+)?(?:experience|employment(?:\s+history)?|work\s+history|career(?:\s+history)?|education|projects?|certifications?|licen[cs]es(?:\s*(?:&|and)\s*certifications)?|summary|profile|objective|about(?:\s+me)?|publications|awards|honou?rs|achievements|accomplishments|languages|volunteer(?:ing)?|interests|hobbies|references|courses|coursework|training|leadership|activities)$/i;

const BULLET = /^[\s\-–—•*·▪●◦‣]+/;
const ITEM_SEPARATOR = /[,;|•·▪●/]+/;
/**
 * A list item names something; a run of more words than this describes it.
 * Kept short on purpose: missing a list costs only the backstop, while
 * mistaking a terse bullet for one would cap real evidence.
 */
const MAX_ITEM_WORDS = 3;
const MAX_LABEL_WORDS = 4;
const MAX_QUOTE_LINES = 6;

function wordCount(text: string): number {
  return text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

function headingText(line: string): string {
  return line.replace(BULLET, "").replace(/[:\s]+$/, "").trim();
}

/** "Cloud: AWS, GCP" → ["Cloud", "AWS, GCP"]; a line without a short label → [null, line]. */
function splitLabel(line: string): [string | null, string] {
  const match = /^([^:|–—]{1,40}?)\s*[:|–—]\s*(\S.*)$/.exec(line.replace(BULLET, "").trim());
  if (!match || wordCount(match[1]) > MAX_LABEL_WORDS) return [null, line];
  return [match[1].trim(), match[2]];
}

function isListLike(text: string): boolean {
  const items = text.split(ITEM_SEPARATOR).filter((item) => /[\p{L}\p{N}]/u.test(item));
  return items.length > 0 && items.every((item) => wordCount(item) <= MAX_ITEM_WORDS);
}

/**
 * Which lines only name skills: a line labelled like "Skills: …" and the
 * list-like lines that follow it (a wrapped list), or those under a skills
 * heading, until another section starts or a line reads as a description
 * rather than a list.
 */
export function listingLines(lines: string[]): boolean[] {
  let inSkills = false;
  return lines.map((line) => {
    const heading = headingText(line);
    if (heading === "") return false;
    if (LIST_HEADING.test(heading)) {
      inSkills = true;
      return true;
    }
    if (SECTION_HEADING.test(heading)) {
      inSkills = false;
      return false;
    }
    const [label, rest] = splitLabel(line);
    if (label !== null && LIST_HEADING.test(label)) {
      inSkills = true;
      return true;
    }
    if (label !== null && SECTION_HEADING.test(label)) {
      inSkills = false;
      return false;
    }
    if (inSkills && isListLike(rest)) return true;
    inSkills = false;
    return false;
  });
}

/**
 * Whether a quote found in the resume sits only in skills lists, so it shows
 * a skill named rather than used. Every shortest run of lines holding the
 * quote has to be listing lines; one occurrence anywhere else is enough to
 * count as real evidence.
 */
export function isListedOnly(quote: string, resumeText: string): boolean {
  const target = canonicalForMatch(quote);
  if (target === "") return false;
  const lines = resumeText.split("\n");
  const canonical = lines.map(canonicalForMatch);
  const listing = listingLines(lines);
  const holds = (from: number, to: number) => canonical.slice(from, to + 1).join("").includes(target);

  let found = false;
  for (let start = 0; start < lines.length; start++) {
    for (let end = start; end < Math.min(lines.length, start + MAX_QUOTE_LINES); end++) {
      if (!holds(start, end)) continue;
      const shortest = !(start < end && holds(start + 1, end));
      if (shortest) {
        found = true;
        if (!listing.slice(start, end + 1).every(Boolean)) return false;
      }
      break;
    }
  }
  return found;
}
