import {
  candidateProfileSchema,
  type CandidateProfile,
} from "../validators/extraction";

export class ExtractionError extends Error {}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").toLowerCase();
}

export function extractJson(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new ExtractionError("Model response contained no JSON object.");
  }
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new ExtractionError("Model response was not valid JSON.");
  }
}

/**
 * Validates the model output and drops an email that does not literally appear
 * in the resume — the one field where a hallucinated value would be silently
 * wrong and hard for a recruiter to catch. Name and headline are trusted as
 * returned: the recruiter confirms them before saving, and the headline is a
 * synthesis rather than a quote.
 */
export function parseProfile(raw: unknown, resumeText: string): CandidateProfile {
  const profile = candidateProfileSchema.parse(raw);
  if (
    profile.email &&
    !normalize(resumeText).includes(normalize(profile.email))
  ) {
    return { ...profile, email: null };
  }
  return profile;
}
