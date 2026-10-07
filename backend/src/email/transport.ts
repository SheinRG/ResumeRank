import { Resend } from "resend";
import { createTransport, type Transporter } from "nodemailer";

import { env } from "../env";
import { log } from "../observability/log";

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  actionUrl: string;
}

export interface DeliveryReceipt {
  provider: "resend" | "smtp" | "log";
  /** The provider's id, which its delivery webhooks refer back to. */
  messageId: string | null;
}

/** `retryable` decides between a backoff and a terminal failure. */
export class DeliveryError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "DeliveryError";
  }
}

export type Deliver = (email: OutgoingEmail, idempotencyKey: string) => Promise<DeliveryReceipt>;

const RETRYABLE_RESEND_ERRORS: ReadonlySet<string> = new Set([
  "rate_limit_exceeded",
  "daily_quota_exceeded",
  "monthly_quota_exceeded",
  "concurrent_idempotent_requests",
  "application_error",
  "internal_server_error",
]);

/** A null status is a network failure the SDK reported instead of throwing. */
export function classifyResendError(error: {
  name: string;
  statusCode: number | null;
  message: string;
}): DeliveryError {
  const retryable =
    error.statusCode === null ||
    error.statusCode === 429 ||
    error.statusCode >= 500 ||
    RETRYABLE_RESEND_ERRORS.has(error.name);
  return new DeliveryError(`Resend ${error.name}: ${error.message}`, retryable);
}

const PERMANENT_SMTP_CODES: ReadonlySet<string> = new Set(["EAUTH", "EENVELOPE", "EMESSAGE"]);

/**
 * SMTP reply codes carry the answer: 4xx is "try again later", 5xx is final.
 * Connection-level failures have no reply code and are worth retrying, except
 * rejected credentials or a malformed message, which won't fix themselves.
 */
export function classifySmtpError(error: unknown): DeliveryError {
  const fields = typeof error === "object" && error !== null ? error : {};
  const responseCode =
    "responseCode" in fields && typeof fields.responseCode === "number" ? fields.responseCode : null;
  const code = "code" in fields && typeof fields.code === "string" ? fields.code : null;
  const message = error instanceof Error ? error.message : String(error);

  const retryable =
    responseCode !== null ? responseCode < 500 : !(code !== null && PERMANENT_SMTP_CODES.has(code));
  return new DeliveryError(`SMTP ${responseCode ?? code ?? "error"}: ${message}`, retryable);
}

// Connections are pooled across sends; the transport config comes from the
// frozen env, so one instance serves the process.
let transporter: Transporter | null = null;

function smtpTransport(): Transporter {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD } = env();
  transporter ??= createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    // 465 is implicit TLS; everything else negotiates STARTTLS, which we
    // require rather than allow — these credentials must never cross in clear.
    secure: SMTP_PORT === 465,
    requireTLS: SMTP_PORT !== 465,
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
  });
  return transporter;
}

async function sendViaResend(email: OutgoingEmail, apiKey: string, idempotencyKey: string): Promise<DeliveryReceipt> {
  let response: Awaited<ReturnType<Resend["emails"]["send"]>>;
  try {
    // The key makes a retry after a lost response (a worker killed between
    // the API call and recording it) a no-op at Resend instead of a duplicate.
    response = await new Resend(apiKey).emails.send(
      { from: env().EMAIL_FROM, to: email.to, subject: email.subject, html: email.html },
      { idempotencyKey },
    );
  } catch (cause) {
    throw new DeliveryError(`Resend request failed: ${cause instanceof Error ? cause.message : String(cause)}`, true);
  }
  if (response.error) throw classifyResendError(response.error);
  return { provider: "resend", messageId: response.data.id };
}

async function sendViaSmtp(email: OutgoingEmail): Promise<DeliveryReceipt> {
  try {
    const info = await smtpTransport().sendMail({
      from: env().EMAIL_FROM,
      to: email.to,
      subject: email.subject,
      html: email.html,
    });
    return { provider: "smtp", messageId: typeof info.messageId === "string" ? info.messageId : null };
  } catch (cause) {
    throw classifySmtpError(cause);
  }
}

/**
 * Delivery is chosen by what's configured, so no code changes between a laptop
 * and production. Resend leads because a verified domain is the only way to
 * reach arbitrary recipients with good deliverability; SMTP is the escape hatch
 * for anyone without a domain (a Gmail app password reaches real inboxes); and
 * with neither, the action link goes to the server log so local development
 * never blocks on an email provider.
 */
export const deliverEmail: Deliver = async (email, idempotencyKey) => {
  const { RESEND_API_KEY, SMTP_HOST, SMTP_USER, SMTP_PASSWORD } = env();

  if (RESEND_API_KEY) return sendViaResend(email, RESEND_API_KEY, idempotencyKey);
  if (SMTP_HOST && SMTP_USER && SMTP_PASSWORD) return sendViaSmtp(email);

  log.info("email.logged", { to: email.to, subject: email.subject, link: email.actionUrl });
  return { provider: "log", messageId: null };
};
