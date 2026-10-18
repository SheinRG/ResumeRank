import { expect, test } from "@playwright/test";

/**
 * The candidate-facing compliance pages need no sign-in: the model card, a
 * company's AI notice, and the self-identification form (which refuses a
 * link that doesn't verify).
 *
 * Prerequisites: a seeded database (`npm run db:seed`), whose company slug is
 * `acme-talent`.
 */

test("the model card states the model and its measured results", async ({ page }) => {
  await page.goto("/ai");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("People decide.");
  await expect(page.getByText("Verdict agreement with recruiters")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Where it falls short" })).toBeVisible();
});

test("a company's AI notice explains the opt-out", async ({ page }) => {
  await page.goto("/ai-notice/acme-talent");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("uses AI in screening");
  await expect(page.getByText("You can ask not to be assessed by AI.")).toBeVisible();
});

// The page streams into its frame, so a missing company shows the not-found
// page rather than a 404 status.
test("an unknown company has no notice page", async ({ page }) => {
  await page.goto("/ai-notice/no-such-company-here");
  await expect(page.getByText("This page could not be found.")).toBeVisible();
  await expect(page.getByText("uses AI in screening")).toHaveCount(0);
});

test("a tampered self-identification link is refused", async ({ page }) => {
  await page.goto("/self-id/not-a-real-application.forgedsignature");
  await expect(page.getByText("This link isn't valid")).toBeVisible();
});
