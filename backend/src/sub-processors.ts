import { env } from "./env";

export interface SubProcessor {
  name: string;
  purpose: string;
  data: string;
  when: string;
}

type SubProcessorConfig = Partial<
  Record<
    | "VERCEL"
    | "DATABASE_URL"
    | "BLOB_READ_WRITE_TOKEN"
    | "GROQ_API_KEY"
    | "RESEND_API_KEY"
    | "SMTP_HOST"
    | "SMTP_USER"
    | "SMTP_PASSWORD"
    | "STRIPE_SECRET_KEY"
    | "AUTH_GOOGLE_ID"
    | "AUTH_GOOGLE_SECRET",
    string | undefined
  >
>;

/** Mirrors smtpSettings in email/transport.ts: explicit SMTP wins, then a bare Resend key. */
function emailProvider(config: SubProcessorConfig): string | null {
  const { SMTP_HOST, SMTP_USER, SMTP_PASSWORD, RESEND_API_KEY } = config;
  if (SMTP_HOST && SMTP_USER && SMTP_PASSWORD) {
    if (SMTP_HOST === "smtp.resend.com") return "Resend";
    if (SMTP_HOST.endsWith(".gmail.com")) return "Google (Gmail)";
    return null;
  }
  return RESEND_API_KEY ? "Resend" : null;
}

function databaseHost(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * The third parties this deployment actually sends customer data to, read
 * from its configuration so the public list can't drift from what runs. A
 * service the operator hosts themselves (their own Postgres or SMTP relay)
 * isn't a sub-processor, so only named providers are listed.
 */
export function subProcessors(config: SubProcessorConfig): SubProcessor[] {
  const list: SubProcessor[] = [];

  if (config.VERCEL) {
    list.push({
      name: "Vercel",
      purpose: "Application hosting",
      data: "All application traffic",
      when: "Always",
    });
  }
  if (databaseHost(config.DATABASE_URL)?.endsWith(".neon.tech")) {
    list.push({
      name: "Neon",
      purpose: "Managed Postgres database",
      data: "All workspace data",
      when: "Always",
    });
  }
  if (config.BLOB_READ_WRITE_TOKEN) {
    list.push({
      name: "Vercel Blob",
      purpose: "Resume file storage",
      data: "Uploaded resume files",
      when: "When a resume file is uploaded",
    });
  }
  if (config.GROQ_API_KEY) {
    list.push({
      name: "Groq",
      purpose: "AI model inference for scoring",
      data: "Job requirements and the resume text of the application being scored",
      when: "When an application is scored",
    });
  }
  const email = emailProvider(config);
  if (email) {
    list.push({
      name: email,
      purpose: "Transactional email",
      data: "Recipient address and message content",
      when: "When an email is sent",
    });
  }
  if (config.STRIPE_SECRET_KEY) {
    list.push({
      name: "Stripe",
      purpose: "Billing",
      data: "Workspace name, billing contact and payment details",
      when: "On paid plans",
    });
  }
  if (config.AUTH_GOOGLE_ID && config.AUTH_GOOGLE_SECRET) {
    list.push({
      name: "Google",
      purpose: "Sign in with Google",
      data: "Name, email address and profile picture",
      when: "When you sign in with Google",
    });
  }

  return list;
}

export function activeSubProcessors(): SubProcessor[] {
  return subProcessors(env());
}
