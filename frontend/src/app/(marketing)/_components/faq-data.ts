export interface FaqItem {
  question: string;
  answer: string;
}

// Single source of truth for both the rendered FAQ and the FAQPage JSON-LD —
// the two must match exactly, so both read from here.
export const FAQ_ITEMS: FaqItem[] = [
  {
    question: "Do I need to upload resume files?",
    answer:
      "Not yet — you paste resume text when you add a candidate. File upload and parsing (PDF/DOCX) is deferred so the core screening flow stays friction-free; pasted text is the scoring input either way.",
  },
  {
    question: "What AI model scores candidates?",
    answer:
      "ResumeRank uses Groq (llama-3.3-70b-versatile by default) with a strict JSON response contract validated by Zod, so a malformed response never produces a partial or silently wrong score.",
  },
  {
    question: "Is my data used to train any AI model?",
    answer:
      "No. Job and resume text is sent to Groq only to generate the scoring response for that request. It is not used to train ResumeRank or any third-party model.",
  },
  {
    question: "How is the score actually calculated?",
    answer:
      "Every requirement gets a verdict — strong, partial, or missing. Must-have requirements count twice as much as nice-to-haves, and a partial verdict earns half credit. The result is a 0–100 weighted match percentage.",
  },
  {
    question: "Who can see or change what?",
    answer:
      "Roles are enforced server-side on every request: owners and admins manage the team, members can create and edit records, and viewers can look but never write.",
  },
  {
    question: "What does it cost?",
    answer:
      "ResumeRank is a demo/trial project, not a commercial product — there's no billing. Create an account and try the full flow with your own job and candidates.",
  },
];
