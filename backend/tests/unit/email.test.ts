import { createHmac, randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { decideRetry, emailRetryDelayMs, MAX_EMAIL_ATTEMPTS } from "../../src/email/policy";
import { openEmail, outboxKey, sealEmail } from "../../src/email/sealed";
import { classifySmtpError, providerMessageId, RESEND_SMTP_HOST, smtpSettings } from "../../src/email/transport";
import { verifyResendWebhook } from "../../src/email/webhooks";

const content = {
  subject: "Reset your password",
  html: "<p>reset</p>",
  actionUrl: "https://app.test/reset-password?token=raw-secret-token",
};

describe("sealed email payloads", () => {
  const key = outboxKey("a-long-enough-auth-secret");

  it("round-trips and never stores the link in clear", () => {
    const sealed = sealEmail(content, "msg-1", "a@example.test", key);
    expect(sealed).not.toContain("raw-secret-token");
    expect(openEmail(sealed, "msg-1", "a@example.test", key)).toEqual(content);
  });

  it("refuses a payload moved to another row or another recipient", () => {
    const sealed = sealEmail(content, "msg-1", "a@example.test", key);
    expect(openEmail(sealed, "msg-2", "a@example.test", key)).toBeNull();
    expect(openEmail(sealed, "msg-1", "attacker@example.test", key)).toBeNull();
  });

  it("refuses tampering, a rotated secret and malformed input", () => {
    const sealed = sealEmail(content, "msg-1", "a@example.test", key);
    const [version, iv, tag, ciphertext] = sealed.split(".");
    const flipped = Buffer.from(ciphertext ?? "", "base64url");
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    const tampered = [version, iv, tag, flipped.toString("base64url")].join(".");

    expect(openEmail(tampered, "msg-1", "a@example.test", key)).toBeNull();
    expect(openEmail(sealed, "msg-1", "a@example.test", outboxKey("another-auth-secret"))).toBeNull();
    expect(openEmail("v1.only-two", "msg-1", "a@example.test", key)).toBeNull();
    expect(openEmail(`v2.${sealed.slice(3)}`, "msg-1", "a@example.test", key)).toBeNull();
  });
});

describe("email retry policy", () => {
  const now = new Date("2026-10-07T12:00:00Z");
  const later = new Date("2026-10-08T12:00:00Z");

  it("backs off exponentially with jitter and a cap", () => {
    expect(emailRetryDelayMs(1, () => 0.5)).toBe(30_000);
    expect(emailRetryDelayMs(2, () => 0.5)).toBe(60_000);
    expect(emailRetryDelayMs(1, () => 0)).toBe(24_000);
    expect(emailRetryDelayMs(1, () => 1)).toBe(36_000);
    expect(emailRetryDelayMs(20, () => 0.5)).toBe(30 * 60_000);
  });

  it("retries a transient failure while attempts and the link last", () => {
    const decision = decideRetry({ retryable: true, attempts: 1, expiresAt: later, now, random: () => 0.5 });
    expect(decision).toEqual({ retry: true, nextAttemptAt: new Date(now.getTime() + 30_000) });
  });

  it("gives up on permanent failures, exhausted attempts and links that would expire first", () => {
    expect(decideRetry({ retryable: false, attempts: 1, expiresAt: later, now })).toEqual({
      retry: false,
      reason: "permanent",
    });
    expect(decideRetry({ retryable: true, attempts: MAX_EMAIL_ATTEMPTS, expiresAt: later, now })).toEqual({
      retry: false,
      reason: "attempts",
    });
    const soon = new Date(now.getTime() + 10_000);
    expect(decideRetry({ retryable: true, attempts: 1, expiresAt: soon, now })).toEqual({
      retry: false,
      reason: "expiry",
    });
  });
});

describe("delivery failure classification", () => {
  it("reads SMTP reply codes, and treats bad credentials as permanent", () => {
    const smtp = (fields: object) => classifySmtpError(Object.assign(new Error("smtp"), fields)).retryable;
    expect(smtp({ responseCode: 421 })).toBe(true);
    expect(smtp({ responseCode: 550 })).toBe(false);
    expect(smtp({ code: "ECONNECTION" })).toBe(true);
    expect(smtp({ code: "EAUTH" })).toBe(false);
  });
});

describe("SMTP routing", () => {
  const unset = { SMTP_HOST: undefined, SMTP_PORT: 587, SMTP_USER: undefined, SMTP_PASSWORD: undefined, RESEND_API_KEY: undefined };

  it("prefers explicit SMTP settings, then Resend's relay, then nothing", () => {
    const smtp = { SMTP_HOST: "smtp.example.test", SMTP_PORT: 2525, SMTP_USER: "u", SMTP_PASSWORD: "p" };
    expect(smtpSettings({ ...unset, ...smtp, RESEND_API_KEY: "re_key" })).toEqual({
      host: "smtp.example.test",
      port: 2525,
      user: "u",
      password: "p",
    });
    expect(smtpSettings({ ...unset, RESEND_API_KEY: "re_key" })).toEqual({
      host: RESEND_SMTP_HOST,
      port: 465,
      user: "resend",
      password: "re_key",
    });
    expect(smtpSettings({ ...unset, SMTP_HOST: "smtp.example.test" })).toBeNull();
    expect(smtpSettings(unset)).toBeNull();
  });

  it("keeps the relay's email id when its reply carries one", () => {
    expect(providerMessageId("250 OK 4ef9a417-02e9-4d39-ad75-9611e0fcc33c", "<x@host>")).toBe(
      "4ef9a417-02e9-4d39-ad75-9611e0fcc33c",
    );
    expect(providerMessageId("250 2.0.0 OK queued", "<x@host>")).toBe("<x@host>");
    expect(providerMessageId("250 OK", undefined)).toBeNull();
  });
});

describe("Resend webhook verification", () => {
  const secretBytes = randomBytes(24);
  const payload = JSON.stringify({
    type: "email.delivered",
    created_at: "2026-10-07T12:00:00Z",
    data: { email_id: "e", to: ["a@example.test"] },
  });

  function sign(id: string, timestamp: string, body: string): string {
    const digest = createHmac("sha256", secretBytes).update(`${id}.${timestamp}.${body}`).digest("base64");
    return `v1,${digest}`;
  }

  beforeAll(() => {
    vi.stubEnv("DATABASE_URL", "postgresql://unused");
    vi.stubEnv("AUTH_SECRET", "a-long-enough-auth-secret");
    vi.stubEnv("RESEND_WEBHOOK_SECRET", `whsec_${secretBytes.toString("base64")}`);
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("accepts a correctly signed, fresh event", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const event = verifyResendWebhook(payload, { id: "msg_1", timestamp, signature: sign("msg_1", timestamp, payload) });
    expect(event?.type).toBe("email.delivered");
  });

  it("rejects a changed body, a stale timestamp and missing headers", () => {
    const now = String(Math.floor(Date.now() / 1000));
    const stale = String(Math.floor(Date.now() / 1000) - 60 * 60);
    expect(
      verifyResendWebhook(payload.replace("delivered", "bounced"), {
        id: "msg_1",
        timestamp: now,
        signature: sign("msg_1", now, payload),
      }),
    ).toBeNull();
    expect(
      verifyResendWebhook(payload, { id: "msg_1", timestamp: stale, signature: sign("msg_1", stale, payload) }),
    ).toBeNull();
    expect(verifyResendWebhook(payload, { id: null, timestamp: now, signature: "v1,x" })).toBeNull();
  });

  it("accepts any one of several signatures, as during a secret rotation", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = `v1,${randomBytes(32).toString("base64")} ${sign("msg_1", timestamp, payload)}`;
    expect(verifyResendWebhook(payload, { id: "msg_1", timestamp, signature })?.type).toBe("email.delivered");
  });

  it("passes unknown event types through as ignorable and rejects malformed known ones", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const verify = (body: string) =>
      verifyResendWebhook(body, { id: "msg_2", timestamp, signature: sign("msg_2", timestamp, body) });
    const opened = JSON.stringify({ type: "email.opened", created_at: "2026-10-07T12:00:00Z", data: {} });
    const bounceWithoutDetail = JSON.stringify({
      type: "email.bounced",
      created_at: "2026-10-07T12:00:00Z",
      data: { email_id: "e", to: ["a@example.test"] },
    });
    expect(verify(opened)?.type).toBe("other");
    expect(verify(bounceWithoutDetail)).toBeNull();
    expect(verify("not json")).toBeNull();
  });
});
