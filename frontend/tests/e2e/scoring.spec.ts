import { expect, test } from "@playwright/test";

import { signIn } from "./support/auth";
import { DEMO_ADMIN, demoCompanyId, withDb } from "./support/db";

let applicationId: string;

test.beforeAll(async () => {
  applicationId = await withDb(async (db) => {
    const { rows } = await db.query<{ id: string }>(
      `SELECT a.id FROM "Application" a
       JOIN "Candidate" c ON c.id = a."candidateId"
       JOIN "Job" j ON j.id = a."jobId"
       WHERE a."companyId" = $1 AND a."deletedAt" IS NULL AND j.status = 'OPEN'
         AND char_length(c."resumeText") >= 200
         AND EXISTS (SELECT 1 FROM "JobRequirement" r WHERE r."jobId" = j.id)
       ORDER BY a."aiScore" NULLS FIRST, a.id
       LIMIT 1`,
      [await demoCompanyId(db)],
    );
    return rows[0]?.id ?? "";
  });
});

/**
 * CI has no LLM key, so a scoring request must surface the named
 * configuration error instead of hanging or failing silently. The request
 * still travels the real path: server action, queue and status reporting.
 */
test("a scoring request without a configured model reports why it failed", async ({ page }) => {
  test.skip(Boolean(process.env.GROQ_API_KEY), "a live key would call the real LLM");
  expect(applicationId).not.toBe("");

  await signIn(page, DEMO_ADMIN);
  await page.goto(`/applications/${applicationId}`);
  await page.getByRole("button", { name: /Score with AI|Rescore/ }).click();

  await expect(page.getByText(/AI scoring is not configured/i).first()).toBeVisible({
    timeout: 30_000,
  });
});
