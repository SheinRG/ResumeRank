import { Resend } from "resend";
import { env } from "@/lib/env";

interface Email {
  to: string;
  subject: string;
  html: string;
  actionUrl: string;
}

/**
 * Sends via Resend when configured; otherwise logs the action link to the
 * server console so local development never blocks on an email provider.
 */
async function send(email: Email): Promise<void> {
  const { RESEND_API_KEY, EMAIL_FROM } = env();
  if (!RESEND_API_KEY) {
    console.info(
      `[email:dev] to=${email.to} subject="${email.subject}"\n[email:dev] link: ${email.actionUrl}`,
    );
    return;
  }
  const resend = new Resend(RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: EMAIL_FROM,
    to: email.to,
    subject: email.subject,
    html: email.html,
  });
  if (error) {
    throw new Error(`Email delivery failed: ${error.message}`);
  }
}

function emailShell(heading: string, body: string, cta: string, url: string): string {
  return `
  <div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#18181b">
    <p style="font-size:14px;font-weight:600;letter-spacing:0.04em;color:#6366f1;margin:0 0 24px">RESUMERANK</p>
    <h1 style="font-size:20px;line-height:1.3;margin:0 0 12px">${heading}</h1>
    <p style="font-size:15px;line-height:1.6;color:#3f3f46;margin:0 0 24px">${body}</p>
    <a href="${url}" style="display:inline-block;background:#4f46e5;color:#ffffff;font-size:14px;font-weight:600;padding:10px 20px;border-radius:8px;text-decoration:none">${cta}</a>
    <p style="font-size:13px;line-height:1.6;color:#71717a;margin:24px 0 0">If the button doesn't work, paste this link into your browser:<br/><a href="${url}" style="color:#4f46e5;word-break:break-all">${url}</a></p>
  </div>`;
}

export async function sendVerificationEmail(
  to: string,
  token: string,
): Promise<void> {
  const url = `${env().NEXT_PUBLIC_APP_URL}/verify-email?email=${encodeURIComponent(to)}&token=${encodeURIComponent(token)}`;
  await send({
    to,
    subject: "Verify your email — ResumeRank",
    actionUrl: url,
    html: emailShell(
      "Verify your email",
      "Confirm this address to unlock write access to your workspace. The link expires in 24 hours.",
      "Verify email",
      url,
    ),
  });
}

export async function sendPasswordResetEmail(
  to: string,
  token: string,
): Promise<void> {
  const url = `${env().NEXT_PUBLIC_APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
  await send({
    to,
    subject: "Reset your password — ResumeRank",
    actionUrl: url,
    html: emailShell(
      "Reset your password",
      "We received a request to reset your password. This link expires in 30 minutes and can be used once. If you didn't ask for this, ignore this email.",
      "Reset password",
      url,
    ),
  });
}
