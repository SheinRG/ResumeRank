import { expect, test } from "@playwright/test";

import { signIn } from "./support/auth";
import { DEMO_VIEWER } from "./support/db";

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
