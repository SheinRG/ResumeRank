import { randomUUID } from "node:crypto";

import type { WebhookEventPayload } from "resend";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "../../src/db";
import { queuePasswordResetEmail } from "../../src/email/messages";
import { applyEmailEvent, drainEmailOutbox, enqueueEmail } from "../../src/email/outbox";
import { DeliveryError, type Deliver, type OutgoingEmail } from "../../src/email/transport";
import { inviteMember } from "../../src/services/team";
import { createTenant, destroyTenant, type TenantFixture } from "./fixtures";

const run = randomUUID().slice(0, 8);
let counter = 0;

/** Unique per test so concurrent rows from other suites never get counted. */
function address(label: string): string {
  counter += 1;
  return `${label}-${counter}-${run}@outbox.test`;
}

function recorder(result: Partial<Awaited<ReturnType<Deliver>>> = {}) {
  const sent: OutgoingEmail[] = [];
  const deliver: Deliver = async (email) => {
    sent.push(email);
    return { provider: "resend", messageId: `re_${randomUUID()}`, ...result };
  };
  return { sent, deliver, to: (to: string) => sent.filter((email) => email.to === to) };
}

const failing =
  (retryable: boolean): Deliver =>
  async () => {
    throw new DeliveryError("Provider said no.", retryable);
  };

async function messageFor(to: string) {
  return db.emailMessage.findFirstOrThrow({ where: { to }, orderBy: { createdAt: "desc" } });
}

const tomorrow = () => new Date(Date.now() + 24 * 60 * 60_000);

let tenant: TenantFixture;

beforeAll(async () => {
  tenant = await createTenant("outbox");
});

afterAll(async () => {
  await db.emailMessage.deleteMany({ where: { to: { endsWith: `${run}@outbox.test` } } });
  await db.emailSuppression.deleteMany({ where: { email: { endsWith: `${run}@outbox.test` } } });
  if (tenant) await destroyTenant(tenant);
  await db.$disconnect();
});

describe("email outbox", () => {
  it("delivers a queued message once and drops its payload", async () => {
    const to = address("reset");
    await queuePasswordResetEmail(to, "raw-reset-token");

    const queued = await messageFor(to);
    expect(queued).toMatchObject({ status: "QUEUED", kind: "PASSWORD_RESET", attempts: 0 });
    expect(queued.payload).not.toContain("raw-reset-token");

    const { deliver, to: deliveredTo } = recorder();
    await drainEmailOutbox({ deliver });

    const [delivered] = deliveredTo(to);
    expect(deliveredTo(to)).toHaveLength(1);
    expect(delivered?.actionUrl).toContain("raw-reset-token");
    const sent = await messageFor(to);
    expect(sent).toMatchObject({ status: "SENT", payload: null, attempts: 1, provider: "resend", error: null });
    expect(sent.sentAt).not.toBeNull();
    expect(sent.providerMessageId).toMatch(/^re_/);
  });

  it("never double-sends when drains overlap", async () => {
    const recipients = Array.from({ length: 6 }, () => address("burst"));
    await Promise.all(recipients.map((to) => queuePasswordResetEmail(to, "token")));

    const { deliver, to: deliveredTo } = recorder();
    await Promise.all([1, 2, 3].map(() => drainEmailOutbox({ deliver, lanes: 2 })));

    for (const to of recipients) expect(deliveredTo(to)).toHaveLength(1);
  });

  it("is written with the caller's transaction or not at all", async () => {
    const to = address("rolled-back");
    await expect(
      db.$transaction(async (tx) => {
        await queuePasswordResetEmail(to, "token", tx);
        throw new Error("Abort.");
      }),
    ).rejects.toThrow("Abort.");
    expect(await db.emailMessage.count({ where: { to } })).toBe(0);
  });

  it("queues invites inside the tenant transaction", async () => {
    const to = address("invitee");
    await inviteMember(tenant.owner, { email: to, role: "MEMBER" });
    expect(await messageFor(to)).toMatchObject({ status: "QUEUED", kind: "INVITE" });
  });

  it("backs off a transient failure and keeps the payload for the retry", async () => {
    const to = address("transient");
    await queuePasswordResetEmail(to, "token");
    const before = Date.now();
    await drainEmailOutbox({ deliver: failing(true) });

    const message = await messageFor(to);
    expect(message).toMatchObject({ status: "QUEUED", attempts: 1, error: "Provider said no." });
    expect(message.payload).not.toBeNull();
    expect(message.nextAttemptAt.getTime()).toBeGreaterThan(before);

    // Not due yet, so a drain right away leaves it alone.
    const { deliver, to: deliveredTo } = recorder();
    await drainEmailOutbox({ deliver });
    expect(deliveredTo(to)).toHaveLength(0);
  });

  it("fails a permanent error without retrying", async () => {
    const to = address("permanent");
    await queuePasswordResetEmail(to, "token");
    await drainEmailOutbox({ deliver: failing(false) });
    expect(await messageFor(to)).toMatchObject({ status: "FAILED", attempts: 1, payload: null });
  });

  it("expires a message whose link would no longer work", async () => {
    const to = address("expired");
    await enqueueEmail({
      kind: "PASSWORD_RESET",
      to,
      expiresAt: new Date(Date.now() - 1_000),
      subject: "s",
      html: "h",
      actionUrl: "https://app.test/x",
    });
    const { deliver, to: deliveredTo } = recorder();
    await drainEmailOutbox({ deliver });

    expect(deliveredTo(to)).toHaveLength(0);
    expect(await messageFor(to)).toMatchObject({ status: "EXPIRED", payload: null });
  });

  it("skips suppressed addresses", async () => {
    const to = address("suppressed");
    await db.emailSuppression.create({ data: { email: to, reason: "bounce" } });
    await queuePasswordResetEmail(to, "token");
    const { deliver, to: deliveredTo } = recorder();
    await drainEmailOutbox({ deliver });

    expect(deliveredTo(to)).toHaveLength(0);
    expect(await messageFor(to)).toMatchObject({ status: "SUPPRESSED", payload: null });
  });

  it("refuses a message whose recipient was changed in the database", async () => {
    const to = address("original");
    const attacker = address("attacker");
    await queuePasswordResetEmail(to, "token");
    await db.emailMessage.updateMany({ where: { to }, data: { to: attacker } });

    const { deliver, to: deliveredTo } = recorder();
    await drainEmailOutbox({ deliver });

    expect(deliveredTo(attacker)).toHaveLength(0);
    expect(await messageFor(attacker)).toMatchObject({ status: "FAILED", payload: null });
  });

  it("resends a message whose worker died mid-send", async () => {
    const to = address("stale");
    await queuePasswordResetEmail(to, "token");
    await db.emailMessage.updateMany({
      where: { to },
      data: { status: "SENDING", attempts: 1, lockedAt: new Date(Date.now() - 10 * 60_000) },
    });

    const { deliver, to: deliveredTo } = recorder();
    await drainEmailOutbox({ deliver });

    expect(deliveredTo(to)).toHaveLength(1);
    expect(await messageFor(to)).toMatchObject({ status: "SENT", attempts: 2 });
  });
});

describe("delivery events", () => {
  async function sentMessage(to: string): Promise<string> {
    const providerMessageId = `re_${randomUUID()}`;
    await enqueueEmail({ kind: "INVITE", to, expiresAt: tomorrow(), subject: "s", html: "h", actionUrl: "u" });
    await db.emailMessage.updateMany({
      where: { to },
      data: { status: "SENT", payload: null, providerMessageId, sentAt: new Date() },
    });
    return providerMessageId;
  }

  function event(type: string, to: string, emailId: string, extra: object = {}): WebhookEventPayload {
    const base = { created_at: "2026-10-07T12:00:00.000Z", email_id: emailId, from: "f", to: [to], subject: "s" };
    // Shaped like the verified body Resend posts; the cast stands in for verifyResendWebhook's parse.
    return { type, created_at: "2026-10-07T12:00:01.000Z", data: { ...base, ...extra } } as WebhookEventPayload;
  }

  it("records deliveries", async () => {
    const to = address("delivered");
    const id = await sentMessage(to);
    await applyEmailEvent(event("email.delivered", to, id));
    expect((await messageFor(to)).deliveredAt?.toISOString()).toBe("2026-10-07T12:00:01.000Z");
  });

  it("suppresses hard bounces but not transient ones", async () => {
    const hard = address("hard-bounce");
    const soft = address("soft-bounce");
    const hardId = await sentMessage(hard);
    const softId = await sentMessage(soft);

    await applyEmailEvent(
      event("email.bounced", hard.toUpperCase(), hardId, {
        bounce: { type: "Permanent", subType: "General", message: "No such user" },
      }),
    );
    await applyEmailEvent(
      event("email.bounced", soft, softId, {
        bounce: { type: "Transient", subType: "MailboxFull", message: "Mailbox full" },
      }),
    );

    expect(await messageFor(hard)).toMatchObject({ status: "BOUNCED" });
    expect(await messageFor(soft)).toMatchObject({ status: "BOUNCED" });
    expect(await db.emailSuppression.findUnique({ where: { email: hard } })).toMatchObject({ reason: "bounce" });
    expect(await db.emailSuppression.findUnique({ where: { email: soft } })).toBeNull();
  });

  it("suppresses complaints, idempotently", async () => {
    const to = address("complaint");
    const id = await sentMessage(to);
    await applyEmailEvent(event("email.complained", to, id));
    await applyEmailEvent(event("email.complained", to, id));

    expect(await messageFor(to)).toMatchObject({ status: "COMPLAINED" });
    expect(await db.emailSuppression.count({ where: { email: to } })).toBe(1);
  });
});
