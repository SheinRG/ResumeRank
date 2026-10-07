import { INVITE_TTL_MS, RESET_TTL_MS, VERIFICATION_TTL_MS } from "../auth/tokens";
import { env } from "../env";
import { escapeHtml, singleLine } from "../html";
import { enqueueEmail, type OutboxWriter } from "./outbox";

/**
 * Takes plain text and escapes every value itself, so a caller can pass a
 * user-controlled company or inviter name without thinking about markup.
 */
function emailShell(
  headingText: string,
  bodyText: string,
  ctaText: string,
  actionUrl: string,
): string {
  const heading = escapeHtml(headingText);
  const body = escapeHtml(bodyText);
  const cta = escapeHtml(ctaText);
  const url = escapeHtml(actionUrl);
  return `
  <div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#18181b">
    <p style="font-size:14px;font-weight:600;letter-spacing:0.04em;color:#6366f1;margin:0 0 24px">RESUMERANK</p>
    <h1 style="font-size:20px;line-height:1.3;margin:0 0 12px">${heading}</h1>
    <p style="font-size:15px;line-height:1.6;color:#3f3f46;margin:0 0 24px">${body}</p>
    <a href="${url}" style="display:inline-block;background:#4f46e5;color:#ffffff;font-size:14px;font-weight:600;padding:10px 20px;border-radius:8px;text-decoration:none">${cta}</a>
    <p style="font-size:13px;line-height:1.6;color:#71717a;margin:24px 0 0">If the button doesn't work, paste this link into your browser:<br/><a href="${url}" style="color:#4f46e5;word-break:break-all">${url}</a></p>
  </div>`;
}

function expiresIn(ttlMs: number): Date {
  return new Date(Date.now() + ttlMs);
}

export async function queueVerificationEmail(to: string, token: string, client?: OutboxWriter): Promise<void> {
  const url = `${env().NEXT_PUBLIC_APP_URL}/verify-email?email=${encodeURIComponent(to)}&token=${encodeURIComponent(token)}`;
  await enqueueEmail(
    {
      kind: "VERIFY_EMAIL",
      to,
      expiresAt: expiresIn(VERIFICATION_TTL_MS),
      subject: "Verify your email — ResumeRank",
      actionUrl: url,
      html: emailShell(
        "Verify your email",
        "Confirm this address to unlock write access to your workspace. The link expires in 24 hours.",
        "Verify email",
        url,
      ),
    },
    client,
  );
}

interface InviteEmailInput {
  to: string;
  token: string;
  companyName: string;
  inviterName: string;
}

export async function queueInviteEmail(
  { to, token, companyName, inviterName }: InviteEmailInput,
  client?: OutboxWriter,
): Promise<void> {
  const url = `${env().NEXT_PUBLIC_APP_URL}/invite?token=${encodeURIComponent(token)}`;
  await enqueueEmail(
    {
      kind: "INVITE",
      to,
      expiresAt: expiresIn(INVITE_TTL_MS),
      subject: singleLine(`${inviterName} invited you to join ${companyName} on ResumeRank`),
      actionUrl: url,
      html: emailShell(
        `Join ${companyName} on ResumeRank`,
        `${inviterName} invited you to join ${companyName}'s workspace on ResumeRank. This link expires in 7 days.`,
        "Accept invite",
        url,
      ),
    },
    client,
  );
}

export async function queuePasswordResetEmail(to: string, token: string, client?: OutboxWriter): Promise<void> {
  const url = `${env().NEXT_PUBLIC_APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
  await enqueueEmail(
    {
      kind: "PASSWORD_RESET",
      to,
      expiresAt: expiresIn(RESET_TTL_MS),
      subject: "Reset your password — ResumeRank",
      actionUrl: url,
      html: emailShell(
        "Reset your password",
        "We received a request to reset your password. This link expires in 30 minutes and can be used once. If you didn't ask for this, ignore this email.",
        "Reset password",
        url,
      ),
    },
    client,
  );
}
