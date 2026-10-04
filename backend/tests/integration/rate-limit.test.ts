import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

import { db } from "../../src/db";
import { AI_BUDGET_EXHAUSTED, assertAiBudget, chargeAiTokens, getAiBudget } from "../../src/ai-budget";
import {
  ACCOUNT_FAILURE_LIMIT,
  beginLoginAttempt,
  clearFailedLogins,
  LOGIN_IP_LIMIT,
  loginBlocked,
  recordFailedLogin,
} from "../../src/auth/login-throttle";
import {
  AI_COMPANY_LIMIT,
  AI_USER_LIMIT,
  checkAiQuota,
  clearRateLimit,
  peekRateLimit,
  rateLimit,
  recordUsage,
  usageInWindow,
} from "../../src/rate-limit";

const WINDOW = { max: 3, windowMs: 60_000 };
/** A timestamp exactly at the start of a window, so tests control the sliding weight. */
const WINDOW_START = Math.floor(Date.now() / WINDOW.windowMs) * WINDOW.windowMs;

const uniqueKey = () => `test:${randomUUID()}`;
const createdCompanyIds: string[] = [];

afterAll(async () => {
  await db.rateLimitCounter.deleteMany({ where: { key: { startsWith: "test:" } } });
  await db.company.deleteMany({ where: { id: { in: createdCompanyIds } } });
  await db.$disconnect();
});

describe("rateLimit", () => {
  it("allows up to the limit, then refuses with a retry hint", async () => {
    const key = uniqueKey();
    for (let i = 0; i < 3; i++) {
      expect((await rateLimit(key, WINDOW, 1, WINDOW_START + 1_000)).allowed).toBe(true);
    }
    const refused = await rateLimit(key, WINDOW, 1, WINDOW_START + 1_000);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBe(59);
  });

  it("is exact under concurrency: parallel requests never overshoot", async () => {
    const key = uniqueKey();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => rateLimit(key, { max: 7, windowMs: 60_000 })),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(7);
  });

  it("refuses an oversized request whole, spending nothing", async () => {
    const key = uniqueKey();
    expect((await rateLimit(key, WINDOW, 2, WINDOW_START)).allowed).toBe(true);
    expect((await rateLimit(key, WINDOW, 2, WINDOW_START)).allowed).toBe(false);
    expect((await rateLimit(key, WINDOW, 1, WINDOW_START)).allowed).toBe(true);
    expect((await rateLimit(uniqueKey(), WINDOW, 4, WINDOW_START)).allowed).toBe(false);
  });

  it("slides: the previous window's usage fades out instead of resetting at once", async () => {
    const key = uniqueKey();
    for (let i = 0; i < 3; i++) await rateLimit(key, WINDOW, 1, WINDOW_START);

    const nextWindow = WINDOW_START + WINDOW.windowMs;
    // 10% into the next window, 90% of the previous 3 still counts: 2.7 + 1 > 3.
    expect((await rateLimit(key, WINDOW, 1, nextWindow + 6_000)).allowed).toBe(false);
    // Halfway, 1.5 still counts: one more fits, a second does not.
    expect((await rateLimit(key, WINDOW, 1, nextWindow + 30_000)).allowed).toBe(true);
    expect((await rateLimit(key, WINDOW, 1, nextWindow + 30_000)).allowed).toBe(false);
  });

  it("keys are independent and can be cleared", async () => {
    const [a, b] = [uniqueKey(), uniqueKey()];
    for (let i = 0; i < 3; i++) await rateLimit(a, WINDOW);
    expect((await rateLimit(a, WINDOW)).allowed).toBe(false);
    expect((await rateLimit(b, WINDOW)).allowed).toBe(true);
    await clearRateLimit(a);
    expect((await rateLimit(a, WINDOW)).allowed).toBe(true);
  });
});

describe("peekRateLimit and recordUsage", () => {
  it("peeks without spending and records usage without a cap", async () => {
    const key = uniqueKey();
    expect((await peekRateLimit(key, WINDOW)).allowed).toBe(true);
    expect(await usageInWindow(key, WINDOW.windowMs)).toBe(0);

    await recordUsage(key, WINDOW.windowMs, 5, WINDOW_START);
    expect(await usageInWindow(key, WINDOW.windowMs, WINDOW_START)).toBe(5);
    expect((await peekRateLimit(key, WINDOW, 1, WINDOW_START)).allowed).toBe(false);
  });
});

describe("checkAiQuota", () => {
  it("blocks a user over the per-user window but not their teammates", async () => {
    const [user, company] = [randomUUID(), randomUUID()];
    for (let i = 0; i < AI_USER_LIMIT.max; i++) {
      expect(await checkAiQuota({ userId: user, companyId: company })).toBeNull();
    }
    expect(await checkAiQuota({ userId: user, companyId: company })).toMatch(/too quickly/);
    expect(await checkAiQuota({ userId: randomUUID(), companyId: company })).toBeNull();
    await clearRateLimit(`ai:user:${user}`);
    await clearRateLimit(`ai:company:${company}`);
  });

  it("charges a bulk request one company unit per LLM call", async () => {
    const company = randomUUID();
    const userId = randomUUID();
    const almostAll = AI_COMPANY_LIMIT.max - 1;
    expect(await checkAiQuota({ userId, companyId: company, calls: almostAll })).toBeNull();
    expect(await checkAiQuota({ userId, companyId: company, calls: 2 })).toMatch(/hourly AI limit/);
    expect(await checkAiQuota({ userId, companyId: company, calls: 1 })).toBeNull();
    await clearRateLimit(`ai:user:${userId}`);
    await clearRateLimit(`ai:company:${company}`);
  });
});

describe("login throttling", () => {
  it("locks an account after repeated failures from any IP, until cleared", async () => {
    const email = `${randomUUID()}@example.test`;
    const freshIp = () => `test-ip-${randomUUID()}`;
    for (let i = 0; i < ACCOUNT_FAILURE_LIMIT.max; i++) {
      expect((await beginLoginAttempt(email, freshIp())).allowed).toBe(true);
      await recordFailedLogin(email);
    }
    expect((await beginLoginAttempt(email, freshIp())).allowed).toBe(false);
    expect((await loginBlocked(email, freshIp())).allowed).toBe(false);

    await clearFailedLogins(email);
    expect((await beginLoginAttempt(email, freshIp())).allowed).toBe(true);
  });

  it("throttles one IP spraying many accounts", async () => {
    const ip = `test-ip-${randomUUID()}`;
    for (let i = 0; i < LOGIN_IP_LIMIT.max; i++) {
      expect((await beginLoginAttempt(`${randomUUID()}@example.test`, ip)).allowed).toBe(true);
    }
    expect((await beginLoginAttempt(`${randomUUID()}@example.test`, ip)).allowed).toBe(false);
    await clearRateLimit(`login:ip:${ip}`);
  });
});

describe("AI token budget", () => {
  it("uses the company override, charges real usage, and blocks once spent", async () => {
    const company = await db.company.create({
      data: { name: "Budget Co", slug: `budget-${randomUUID().slice(0, 8)}`, aiTokenBudget: 1_000 },
    });
    createdCompanyIds.push(company.id);

    expect(await getAiBudget(company.id)).toEqual({ used: 0, budget: 1_000, remaining: 1_000 });
    await chargeAiTokens(company.id, 600);
    await expect(assertAiBudget(company.id)).resolves.toBeUndefined();
    await chargeAiTokens(company.id, 500);

    expect(await getAiBudget(company.id)).toMatchObject({ used: 1_100, remaining: 0 });
    await expect(assertAiBudget(company.id)).rejects.toThrow(AI_BUDGET_EXHAUSTED);
    await clearRateLimit(`ai-tokens:company:${company.id}`);
  });
});
