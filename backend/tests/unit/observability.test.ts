import { afterEach, describe, expect, it, vi } from "vitest";

import { traceLlmCall } from "../../src/observability/llm";
import {
  annotateLogContext,
  errorFields,
  log,
  withLogContext,
} from "../../src/observability/log";

function captured(spy: { mock: { calls: unknown[][] } }): Record<string, unknown>[] {
  return spy.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("log", () => {
  it("writes one JSON object per line with level, event and time", () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    log.info("thing.happened", { count: 2 });

    const [entry] = captured(out);
    expect(entry).toMatchObject({
      level: "info",
      event: "thing.happened",
      count: 2,
      appEnv: "development",
    });
    expect(typeof entry.time).toBe("string");
  });

  it("routes warnings and errors to stderr", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    log.warn("w");
    log.error("e");
    expect(captured(warn)[0]).toMatchObject({ level: "warn", event: "w" });
    expect(captured(error)[0]).toMatchObject({ level: "error", event: "e" });
  });

  it("stamps context fields, including ones annotated later, on nested lines", async () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    await withLogContext({ action: "createJob" }, async () => {
      annotateLogContext({ userId: "u1", companyId: "c1" });
      await Promise.resolve();
      log.info("inner");
    });
    log.info("outside");

    const [inner, outside] = captured(out);
    expect(inner).toMatchObject({ action: "createJob", userId: "u1", companyId: "c1" });
    expect(outside).not.toHaveProperty("action");
  });

  it("keeps concurrent contexts apart", async () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    await Promise.all(
      ["a", "b"].map((action) =>
        withLogContext({ action }, async () => {
          await new Promise((resolve) => setTimeout(resolve, action === "a" ? 10 : 0));
          log.info("done", { expected: action });
        }),
      ),
    );
    for (const entry of captured(out)) {
      expect(entry.action).toBe(entry.expected);
    }
  });

  it("ignores annotations outside a context", () => {
    expect(() => annotateLogContext({ userId: "u1" })).not.toThrow();
  });

  it("never throws on fields JSON cannot encode", () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    log.info("big", { n: 10n });
    log.info("loop", { circular });

    const [big, loop] = captured(out);
    expect(big.n).toBe("10");
    expect(loop).toMatchObject({ event: "loop", logError: "unserialisable fields" });
  });
});

describe("errorFields", () => {
  it("flattens errors and non-error throws", () => {
    expect(errorFields(new TypeError("bad"))).toMatchObject({
      errorName: "TypeError",
      errorMessage: "bad",
    });
    expect(errorFields("oops")).toEqual({ errorName: "string", errorMessage: "oops" });
  });
});

describe("traceLlmCall", () => {
  const info = { operation: "scoring" as const, provider: "groq", model: "test-model", attempt: 1 };

  it("returns the completion with token usage and logs the call", async () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    const completion = { usage: { prompt_tokens: 120, completion_tokens: 30 }, id: "x" };

    const traced = await traceLlmCall(info, async () => completion);

    expect(traced.completion).toBe(completion);
    expect(traced.usage).toEqual({ promptTokens: 120, completionTokens: 30 });
    expect(captured(out)[0]).toMatchObject({
      event: "llm.call",
      operation: "scoring",
      model: "test-model",
      attempt: 1,
      outcome: "ok",
      promptTokens: 120,
      completionTokens: 30,
    });
  });

  it("reports missing usage as null", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const traced = await traceLlmCall(info, async () => ({ usage: null }));
    expect(traced.usage).toEqual({ promptTokens: null, completionTokens: null });
  });

  it("logs provider failures with their HTTP status and rethrows", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = Object.assign(new Error("rate limited"), { status: 429 });

    await expect(traceLlmCall(info, () => Promise.reject(failure))).rejects.toBe(failure);
    expect(captured(err)[0]).toMatchObject({
      event: "llm.call",
      outcome: "provider_error",
      status: 429,
      errorMessage: "rate limited",
    });
  });
});
