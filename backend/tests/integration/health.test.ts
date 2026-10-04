import { afterAll, describe, expect, it } from "vitest";

import { db } from "../../src/db";
import { checkDatabase } from "../../src/health";

afterAll(async () => {
  await db.$disconnect();
});

describe("checkDatabase", () => {
  it("reports a reachable database with its latency", async () => {
    const result = await checkDatabase();
    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
