import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { generateApiToken, parseApiToken, secretMatches } from "../../src/api/tokens";
import { createApiKeySchema, createWebhookSchema } from "../../src/validators/api";
import { buildWebhookRequest } from "../../src/webhooks/format";

describe("API tokens", () => {
  it("round-trips: the parsed secret matches the stored hash, and nothing else does", () => {
    const generated = generateApiToken();
    const parsed = parseApiToken(generated.token);
    expect(parsed?.id).toBe(generated.id);
    expect(generated.token.startsWith(generated.prefix)).toBe(true);
    expect(secretMatches(parsed?.secret ?? "", generated.secretHash)).toBe(true);
    expect(secretMatches(generateApiToken().token.slice(-43), generated.secretHash)).toBe(false);
  });

  it("rejects anything that isn't shaped like a key", () => {
    const { token } = generateApiToken();
    for (const bad of ["", "rr_", `Bearer ${token}`, `${token}x`, token.replace("rr_", "sk_"), token.toUpperCase()]) {
      expect(parseApiToken(bad)).toBeNull();
    }
  });
});

describe("webhook requests", () => {
  it("sign the exact body with the timestamp, Stripe-style", () => {
    const now = new Date("2026-10-20T12:00:00Z");
    const payload = { id: "evt_1", type: "ping", createdAt: now.toISOString(), data: { message: "hi" } };
    const request = buildWebhookRequest({ id: "del_1", event: "ping", payload }, "whsec_test", now);

    expect(JSON.parse(request.body)).toEqual(payload);
    expect(request.headers["ResumeRank-Event"]).toBe("ping");
    expect(request.headers["ResumeRank-Delivery"]).toBe("del_1");
    const timestamp = Math.floor(now.getTime() / 1000);
    const digest = createHmac("sha256", "whsec_test").update(`${timestamp}.${request.body}`).digest("hex");
    expect(request.headers["ResumeRank-Signature"]).toBe(`t=${timestamp},v1=${digest}`);
  });
});

describe("validators", () => {
  it("dedupe scopes and events and require at least one", () => {
    expect(
      createApiKeySchema.parse({ name: "Sync", scopes: ["jobs:read", "jobs:read"], expiresInDays: null }).scopes,
    ).toEqual(["jobs:read"]);
    expect(createApiKeySchema.safeParse({ name: "Sync", scopes: [], expiresInDays: 30 }).success).toBe(false);
    expect(createApiKeySchema.safeParse({ name: "Sync", scopes: ["admin"], expiresInDays: 30 }).success).toBe(false);
    expect(createApiKeySchema.safeParse({ name: "Sync", scopes: ["jobs:read"], expiresInDays: 7 }).success).toBe(false);
    expect(createWebhookSchema.safeParse({ url: "https://x.test", events: [] }).success).toBe(false);
  });
});
