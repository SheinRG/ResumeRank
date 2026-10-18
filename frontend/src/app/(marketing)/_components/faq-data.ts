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
      "Either works. Paste resume text when you add a candidate, or upload a PDF or Word file and ResumeRank reads the text out of it in the background, with OCR for scanned pages. The original file is kept for your records.",
  },
  {
    question: "What AI model scores candidates?",
    answer:
      "ResumeRank uses Groq (openai/gpt-oss-120b by default) with a strict JSON response contract validated by Zod, so a malformed response never produces a partial or silently wrong score.",
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
      "Roles are enforced server-side on every request: owners and admins manage the team, members create and edit records, hiring managers and interviewers see only the jobs they're assigned to, and viewers can look but never write. See the security page for the full list of controls.",
  },
  {
    question: "What does it cost?",
    answer:
      "There's a free plan for up to three members. Team and Enterprise are billed per seat through Stripe, with larger AI budgets; Enterprise adds single sign-on, directory sync, audit log streaming and IP allowlisting. ResumeRank is open source, and a self-hosted install without Stripe keeps every feature.",
  },
];
