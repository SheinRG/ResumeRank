import { expect, test } from "@playwright/test";

import { signIn, waitForHydration } from "./support/auth";

/**
 * A person's own format applies everywhere dates are shown, and "workspace
 * default" goes back to the company's.
 *
 * Prerequisites: a seeded database (`npm run db:seed`).
 */
test("a personal locale and time zone change how dates read", async ({ page }) => {
  await signIn(page, "demo@resumerank.app");

  await page.goto("/settings");
  await waitForHydration(page, "#personal-locale");
  await page.locator("#personal-locale").click();
  await page.getByRole("option", { name: "Deutsch (Deutschland)" }).click();
  await page.locator("#personal-time-zone").click();
  await page.getByRole("option", { name: "Asia/Tokyo" }).click();
  await page.getByRole("button", { name: "Save format" }).first().click();
  await expect(page.getByText("Saved. Dates and numbers now use this format.")).toBeVisible();

  await page.goto("/candidates");
  // German short dates read "14. März 2026", not "Mar 14, 2026".
  await expect(page.locator("table time").first()).toHaveText(/^\d{1,2}\. \S+ \d{4}$/);

  await page.goto("/settings");
  await waitForHydration(page, "#personal-locale");
  await page.locator("#personal-locale").click();
  await page.getByRole("option", { name: /^Workspace default/ }).click();
  await page.locator("#personal-time-zone").click();
  await page.getByRole("option", { name: /^Workspace default/ }).click();
  await page.getByRole("button", { name: "Save format" }).first().click();
  await expect(page.getByText("Saved. Dates and numbers now use this format.")).toBeVisible();

  await page.goto("/candidates");
  await expect(page.locator("table time").first()).toHaveText(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
});
