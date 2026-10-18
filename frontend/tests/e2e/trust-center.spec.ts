import { expect, test } from "@playwright/test";

/**
 * The public trust center and its machine-readable twin: both must be
 * reachable signed out, and security.txt must stay valid under RFC 9116
 * (Contact and an Expires less than a year away).
 */

test("the security page is public and links to private reporting", async ({ page }) => {
  await page.goto("/security");

  await expect(page.getByRole("heading", { level: 1 })).toContainText("Here's how we keep it.");
  await expect(page.getByRole("heading", { name: "Tenant isolation" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "SOC 2 Type I" })).toBeVisible();

  const report = page.getByRole("link", { name: "Report a vulnerability" }).last();
  await expect(report).toHaveAttribute("href", /\/security\/advisories\/new$/);
});

test("the landing footer reaches the security page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Footer" }).getByRole("link", { name: "Security" }).click();
  await expect(page).toHaveURL(/\/security$/);
});

test("security.txt names a contact and a valid expiry", async ({ request }) => {
  const response = await request.get("/.well-known/security.txt");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/plain");

  const body = await response.text();
  expect(body).toMatch(/^Contact: https:\/\/github\.com\/.+\/security\/advisories\/new$/m);
  expect(body).toMatch(/^Policy: .+\/security#disclosure$/m);

  const expires = body.match(/^Expires: (.+)$/m)?.[1];
  expect(expires).toBeDefined();
  const until = new Date(expires ?? "").getTime() - Date.now();
  expect(until).toBeGreaterThan(0);
  expect(until).toBeLessThan(365 * 86_400_000);
});
