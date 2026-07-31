import { expect, test } from "@playwright/test";

/**
 * Golden path against the seeded demo workspace: a recruiter signs in, lands on
 * the dashboard, navigates the app shell, and opens a job's ranked applicant
 * pipeline — the core evidence-screening surface. It exercises auth, the
 * session-backed layout guard, routing, and a data-backed detail page without
 * depending on the external LLM (scoring is not invoked).
 *
 * Prerequisites: the app served on the configured port and a seeded database
 * (`npm run db:seed`) so `demo@resumerank.app` exists and is pre-verified.
 */
test("recruiter signs in and reaches a job's ranked applicant pipeline", async ({
  page,
}) => {
  await page.goto("/login");

  // exact: true so "Password" doesn't also match the "Show password" toggle.
  await page.getByLabel("Email", { exact: true }).fill("demo@resumerank.app");
  await page.getByLabel("Password", { exact: true }).fill("demo1234");
  await page.getByRole("button", { name: "Log in" }).click();

  // The layout guard resolves the session against the DB and renders the shell.
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  // Sidebar navigation → jobs list, with the writer-only "New job" affordance.
  await page.getByRole("link", { name: "Jobs" }).click();
  await expect(page).toHaveURL(/\/jobs$/);
  await expect(page.getByRole("heading", { name: "Jobs" })).toBeVisible();
  await expect(page.getByRole("link", { name: "New job" })).toBeVisible();

  // Open the first seeded job and confirm the screening surface renders.
  await page.locator('table a[href^="/jobs/"]').first().click();
  await expect(page).toHaveURL(/\/jobs\/[^/]+$/);
  await expect(page.getByText(/ranked by score/i)).toBeVisible();
});
