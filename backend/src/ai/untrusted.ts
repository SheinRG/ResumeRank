import { createHash } from "node:crypto";

// Zero-width and bidi-control characters: invisible on the page, so text
// hidden with them can't have been written for a human reader.
const INVISIBLE = /[​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

/**
 * Prepares untrusted text for a prompt: removes invisible characters and
 * defuses anything shaped like our block markers, so the text can't close
 * its own block and start writing instructions.
 */
export function neutralize(text: string): string {
  return text.replace(INVISIBLE, "").replace(/<{3,}/g, "‹‹‹").replace(/>{3,}/g, "›››");
}

/**
 * A marker derived from the content it wraps. Text can't contain the hash of
 * a document that includes it, so a block can't be closed from inside even if
 * neutralization missed a variant.
 */
export function blockBoundary(...parts: string[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16).toUpperCase();
}

export function untrustedBlock(boundary: string, name: string, text: string): string {
  return `<<<${boundary}:${name}>>>\n${neutralize(text)}\n<<<${boundary}:END>>>`;
}

const SIGNALS: ReadonlyArray<readonly [signal: string, pattern: RegExp]> = [
  [
    "ignore-instructions",
    /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|your|system)\b[^.\n]{0,20}\b(instructions?|prompts?|rules|guidelines|directions)\b/i,
  ],
  ["role-override", /\byou are (now|no longer)\b|\bact as (an?|the) [a-z ]{0,30}(assistant|model|ai|recruiter|grader)\b|\bnew (instructions|rules|role)\s*:/i],
  ["role-marker", /^\s*(system|assistant|developer)\s*(prompt|message)?\s*:/im],
  [
    "score-steering",
    /\b(rate|score|mark|grade|evaluate|rank|consider)\b[^.\n]{0,30}\b(candidate|applicant|resume|me)\b[^.\n]{0,30}\b(strong|perfect|excellent|top|highest|100|10\s*\/\s*10|must hire|hire)\b/i,
  ],
  ["output-forgery", /"(verdict|requirementId|evaluations)"\s*:/i],
  ["delimiter", /<{3,}|>{3,}|RESUME_(START|END)/],
  ["hidden-text", INVISIBLE],
];

/**
 * Heuristic flags for text that looks written to steer the model rather than
 * inform a reader. Recall over precision: a flag asks a recruiter to look, it
 * doesn't change the score, so a false positive costs a glance.
 */
export function detectInjection(text: string): string[] {
  return SIGNALS.filter(([, pattern]) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  }).map(([signal]) => signal);
}
