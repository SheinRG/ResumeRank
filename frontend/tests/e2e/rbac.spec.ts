import { expect, test } from "@playwright/test";

import { signIn } from "./support/auth";
import {
  addDemoInterviewer,
  DEMO_VIEWER,
  deleteUser,
  uniqueTag,
  withDb,
  type AssignedInterviewer,
} from "./support/db";

/**
 * A viewer reads everything in the workspace but changes nothing: write
 * affordances are hidden, and the write-only routes send them back to a page
 * they can use instead of rendering a form whose submit would be refused.
 */
test.describe("viewer role", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, DEMO_VIEWER);
  });

  test("sees jobs and pipelines without write affordances", async ({ page }) => {
    await page.goto("/jobs");
    await expect(page.getByRole("heading", { name: "Jobs" })).toBeVisible();
    await expect(page.getByRole("link", { name: "New job" })).toHaveCount(0);

    await page.locator('table a[href^="/jobs/"]').first().click();
    await expect(page.getByText(/ranked by score/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Add candidate" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Score all/ })).toHaveCount(0);
  });

  test("is sent away from write-only routes", async ({ page }) => {
    await page.goto("/jobs/new");
    await expect(page).toHaveURL(/\/jobs$/);

    await page.goto("/candidates/new");
    await expect(page).toHaveURL(/\/candidates$/);

    await page.goto("/candidates");
    const profile = page.locator('table a[href^="/candidates/"]').first();
    const href = await profile.getAttribute("href");
    await page.goto(`${href}/edit`);
    await expect(page).toHaveURL(new RegExp(`${href}$`));
  });
});

/**
 * An interviewer reaches only the jobs on their hiring team, and rates blind:
 * no AI score anywhere, and only their own scorecard.
 */
test.describe("interviewer role", () => {
  let interviewer: AssignedInterviewer;

  test.beforeAll(async () => {
    interviewer = await withDb((db) => addDemoInterviewer(db, uniqueTag()));
  });

  test.afterAll(async () => {
    if (interviewer) await withDb((db) => deleteUser(db, interviewer.userId));
  });

  test("sees only their job, without scores", async ({ page }) => {
    await signIn(page, interviewer.email);

    await page.goto("/jobs");
    const jobLinks = page.locator('table a[href^="/jobs/"]');
    await expect(jobLinks).toHaveCount(1);
    await expect(jobLinks.first()).toHaveText(interviewer.jobTitle);
    await expect(page.getByRole("columnheader", { name: "Avg score" })).toHaveCount(0);

    await jobLinks.first().click();
    await expect(page.getByText("Hiring team", { exact: true })).toBeVisible();
    await expect(page.getByText(/ranked by score/i)).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "Score" })).toHaveCount(0);

    await page.locator('table a[href^="/applications/"]').first().click();
    await expect(page.getByText(/Other ratings and the AI score stay hidden/)).toBeVisible();
    await expect(page.getByText(/No AI score yet|Score history/)).toHaveCount(0);

    await page.goto("/activity");
    await expect(page.getByText("Activity is for recruiters and admins")).toBeVisible();
  });
});
