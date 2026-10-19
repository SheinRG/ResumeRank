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
  provider: "smtp" | "log";
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

export const RESEND_SMTP_HOST = "smtp.resend.com";

export interface SmtpSettings {
  host: string;
  port: number;
  user: string;
  password: string;
}

type SmtpEnv = Pick<
  ReturnType<typeof env>,
  "SMTP_HOST" | "SMTP_PORT" | "SMTP_USER" | "SMTP_PASSWORD" | "RESEND_API_KEY"
>;

/**
 * Explicit SMTP settings win. A bare RESEND_API_KEY (how deployments were
 * configured when Resend had its own SDK route) becomes Resend's SMTP relay,
 * whose username is literally "resend" and whose password is the API key, so
 * those deployments keep sending without an env change.
 */
export function smtpSettings(config: SmtpEnv): SmtpSettings | null {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, RESEND_API_KEY } = config;
  if (SMTP_HOST && SMTP_USER && SMTP_PASSWORD) {
    return { host: SMTP_HOST, port: SMTP_PORT, user: SMTP_USER, password: SMTP_PASSWORD };
  }
  if (RESEND_API_KEY) return { host: RESEND_SMTP_HOST, port: 465, user: "resend", password: RESEND_API_KEY };
  return null;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * Resend's webhooks name a message by its email id, so a UUID in the
 * server's 250 reply is kept when there is one. Otherwise the RFC
 * Message-ID, which is at least unique per message; webhook events then fall
 * back to the recipient (`applyEmailEvent`).
 */
export function providerMessageId(response: string, messageId: string | undefined): string | null {
  return response.match(UUID)?.[0] ?? messageId ?? null;
}

// Connections are pooled across sends; the transport config comes from the
// frozen env, so one instance serves the process.
let transporter: Transporter | null = null;

function smtpTransport(settings: SmtpSettings): Transporter {
  transporter ??= createTransport({
    host: settings.host,
    port: settings.port,
    // 465 is implicit TLS; everything else negotiates STARTTLS, which we
    // require rather than allow — these credentials must never cross in clear.
    secure: settings.port === 465,
    requireTLS: settings.port !== 465,
    auth: { user: settings.user, pass: settings.password },
  });
  return transporter;
}

async function sendViaSmtp(
  email: OutgoingEmail,
  settings: SmtpSettings,
  idempotencyKey: string,
): Promise<DeliveryReceipt> {
  try {
    const info = await smtpTransport(settings).sendMail({
      from: env().EMAIL_FROM,
      to: email.to,
      subject: email.subject,
      html: email.html,
      // Resend dedupes on this header, so re-sending after a lost reply (a
      // worker killed between the send and recording it) is a no-op there.
      // Other servers ignore it, and delivery stays at-least-once.
      headers: settings.host === RESEND_SMTP_HOST ? { "Resend-Idempotency-Key": idempotencyKey } : {},
    });
    const messageId = typeof info.messageId === "string" ? info.messageId : undefined;
    const response = typeof info.response === "string" ? info.response : "";
    return { provider: "smtp", messageId: providerMessageId(response, messageId) };
  } catch (cause) {
    throw classifySmtpError(cause);
  }
}

/**
 * One transport, SMTP, chosen by what's configured so no code changes between
 * a laptop and production. SMTP reaches every provider (Resend's relay, SES,
 * Postmark, a Gmail app password, a self-hosted MTA) through one dependency.
 * With nothing configured, the action link goes to the server log so local
 * development never blocks on an email provider.
 */
export const deliverEmail: Deliver = async (email, idempotencyKey) => {
  const settings = smtpSettings(env());
  if (settings) return sendViaSmtp(email, settings, idempotencyKey);

  log.info("email.logged", { to: email.to, subject: email.subject, link: email.actionUrl });
  return { provider: "log", messageId: null };
};
