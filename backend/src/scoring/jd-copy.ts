/** Stored with the injection signals on a run; it never changes the score. */
export const JOB_COPY_SIGNAL = "jd-copy";

/**
 * Eight words in the same order is longer than the stock phrases a resume
 * and a job share by chance ("experience with continuous integration and
 * delivery"), and twenty copied words is at least a full sentence lifted.
 */
const SHINGLE_WORDS = 8;
const MIN_COPIED_WORDS = 20;

export interface JobText {
  description: string;
  requirements: ReadonlyArray<{ label: string }>;
}

function words(text: string): string[] {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

function shingles(text: string): string[] {
  const list = words(text);
  const out: string[] = [];
  for (let i = 0; i + SHINGLE_WORDS <= list.length; i++) out.push(list.slice(i, i + SHINGLE_WORDS).join(" "));
  return out;
}

/** How many of the resume's words sit in runs copied word for word from the job's description or requirements. */
export function copiedWordCount(job: JobText, resumeText: string): number {
  const fromJob = new Set([job.description, ...job.requirements.map((r) => r.label)].flatMap(shingles));
  const resume = words(resumeText);
  const copied = new Uint8Array(resume.length);
  for (let i = 0; i + SHINGLE_WORDS <= resume.length; i++) {
    if (fromJob.has(resume.slice(i, i + SHINGLE_WORDS).join(" "))) copied.fill(1, i, i + SHINGLE_WORDS);
  }
  return copied.reduce((sum, flag) => sum + flag, 0);
}

/**
 * Whether the resume repeats the job's own wording at length. Echoing the
 * posting is what a resume written to match it does, and the model can take
 * the job's sentences for the candidate's experience, so a recruiter should
 * check the evidence came from somewhere else.
 */
export function copiesJob(job: JobText, resumeText: string): boolean {
  return copiedWordCount(job, resumeText) >= MIN_COPIED_WORDS;
}
