import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

config({ path: fileURLToPath(new URL("../.env", import.meta.url)), quiet: true });

// Never fall back to DATABASE_URL: these tests write and delete rows, and the
// root .env usually points at a real database.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error(
    "TEST_DATABASE_URL is required for integration tests. Point it at a disposable Postgres database (see CONTRIBUTING.md).",
  );
}

export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    globalSetup: ["tests/integration/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
    env: {
      DATABASE_URL: testDatabaseUrl,
      AUTH_SECRET: process.env.AUTH_SECRET ?? "integration-test-secret-value",
      // Scoring requests need a key to be accepted; this one is invalid, so
      // nothing can reach a paid LLM — the queue tests inject an evaluator.
      GROQ_API_KEY: "integration-test-invalid-key",
      RESEND_API_KEY: "",
      SMTP_HOST: "",
    },
  },
});
