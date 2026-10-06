import { config } from "dotenv";
import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// The fixture helpers in tests/e2e/support connect to the same database the
// app uses, so they read the root .env just like next.config.ts does.
config({ path: resolve(__dirname, "../.env"), quiet: true });

const PORT = 3105;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // CI exercises the production build (prerendered shells, the use cache
    // layer, real chunking); locally `next dev` keeps the edit loop fast.
    command: process.env.CI ? `npm run start -- -p ${PORT}` : `npm run dev -- -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
